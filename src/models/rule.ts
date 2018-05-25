import * as _ from 'lodash'
import {
    BaseForLines,
    IGameCode,
    IGameNode
} from '../models/game'
import { IGameTile, GameSprite } from './tile'
import {
    IMutator,
    RuleBracketPair,
    SIMPLE_DIRECTIONS,
    CellMutation
} from '../pairs'
import { RULE_MODIFIER, setDifference, setIntersection, nextRandom } from '../util'
import { Cell } from '../engine'
import { GameTree } from '../gameTree';
import { RULE_DIRECTION } from '../enums';

enum RULE_COMMAND {
    AGAIN = 'AGAIN'
}

export const SIMPLE_DIRECTION_DIRECTIONS = new Set([
    RULE_DIRECTION.UP,
    RULE_DIRECTION.DOWN,
    RULE_DIRECTION.LEFT,
    RULE_DIRECTION.RIGHT
])

function opposite(dir: RULE_DIRECTION) {
    switch (dir) {
        case RULE_DIRECTION.UP:
            return RULE_DIRECTION.DOWN
        case RULE_DIRECTION.DOWN:
            return RULE_DIRECTION.UP
        case RULE_DIRECTION.LEFT:
            return RULE_DIRECTION.RIGHT
        case RULE_DIRECTION.RIGHT:
            return RULE_DIRECTION.LEFT
        default:
            throw new Error(`BUG: Invalid direction: "${dir}"`)
    }
}

// Note: Directions inside a Bracket are relative to other dorections inside a bracket
// Example:
//
// Interpret `[ > player > cat | < dog ] -> [ < player | cat < dog ]` to:
// Interpret `[ ^ player v cat | v dog ] -> [ v player | cat v dog ]` to:
// UP    [ UP    player UP    cat | DOWN  dog ] -> [ DOWN  player | cat DOWN  dog ]
// DOWN  [ DOWN  player DOWN  cat | UP    dog ] -> [ UP    player | cat UP    dog ]
// LEFT  [ LEFT  player LEFT  cat | RIGHT dog ] -> [ RIGHT player | cat RIGHT dog ]
// RIGHT [ RIGHT player RIGHT cat | LEFT  dog ] -> [ LEFT  player | cat LEFT  dog ]
//
// Interpret `HORIZONTAL [ > player ] -> [ < crate ] to:
// LEFT  [ LEFT  player ] -> [ RIGHT crate ]
// RIGHT [ RIGHT player ] -> [ LEFT  crate ]
//
// Interpret `VERTICAL [ ^ player PARALLEL cat | PERPENDICULAR dog ] -> [ < crate |  dog ] to:
// UP    [ LEFT   player HORIZONTAL cat ] -> [ DOWN  crate | VERTICAL   dog ]
// DOWN  [ RIGHT  player HORIZONTAL cat ] -> [ UP    crate | VERTICAL   dog ]
// LEFT  [ DOWN   player VERTICAL   cat ] -> [ RIGHT crate | HORIZONTAL dog ]
// DOWN  [ RIGHT  player HORIZONTAL cat ] -> [ UP    crate | HORIZONTAL dog ]
//
// See https://www.puzzlescript.net/Documentation/executionorder.html
export class GameRule extends BaseForLines implements IRule {
    _modifiers: Set<RULE_MODIFIER>
    _commands: string[]
    _bracketPairs: RuleBracketPair[]
    _hasEllipsis: boolean
    _brackets: RuleBracket[]
    // _conditionCommandPair: RuleConditionCommandPair[]

    constructor(source: IGameCode, modifiers: Set<RULE_MODIFIER>, conditions: RuleBracket[], actions: RuleBracket[], commands: string[]) {
        super(source)
        this._modifiers = modifiers
        this._commands = commands
        this._hasEllipsis = false
        this._brackets = conditions

        // Set _hasEllipsis value
        for (let i = 0; i < conditions.length; i++) {
            const condition = conditions[i]
            if (condition.hasEllipsis()) {
                this._hasEllipsis = true
                break
            }
        }

        // Check if valid
        if (conditions.length !== actions.length && actions.length !== 0) {
            throw new Error(`Left side has "${conditions.length}" conditions and right side has "${actions.length}" actions!`)
        }

        // Subscribe the bracket and neighbors to cell Changes (only the condition side)
        conditions.forEach(bracket => {
            bracket.subscribeToNeighborChanges()
            bracket._neighbors.forEach(neighbor => {
                neighbor.subscribeToTileChanges()
                neighbor._tilesWithModifier.forEach(t => {
                    t.subscribeToCellChanges()
                })
            })
        })

        if (conditions.length === actions.length) {
            this._bracketPairs = _.zip(conditions, actions).map(([condition, action]) => {
                return new RuleBracketPair(this._modifiers, condition, action)
            })
        } else if (actions.length !== 0) {
            throw new Error(`Invalid Rule. The number of brackets on the right must match the structure of the left hand side or be 0`)
        }
        // TODO: build the _conditionCommandPair
        if (commands.length > 0) {
            this._bracketPairs = []
        }
    }

    evaluate() {
        if (this._bracketPairs.length === 0 || this.isLate()) {
            // TODO: Just commands are not supported yet
            return []
        }
        const allMutators: CellMutation[][] = []
        // Determine which directions to loop over
        // Include any simple UP, DOWN, LEFT, RIGHT ones
        let directionsToCheck = setIntersection(this._modifiers, SIMPLE_DIRECTIONS)
        // Include LEFT and RIGHT if HORIZONTAL
        if (this._modifiers.has(RULE_MODIFIER.HORIZONTAL)) {
            return [] // not supported properly
            // directionsToCheck.add(RULE_MODIFIER.LEFT)
            // directionsToCheck.add(RULE_MODIFIER.RIGHT)
        }
        // Include UP and DOWN if VERTICAL
        if (this._modifiers.has(RULE_MODIFIER.VERTICAL)) {
            return [] // not supported properly
            // directionsToCheck.add(RULE_MODIFIER.UP)
            // directionsToCheck.add(RULE_MODIFIER.DOWN)
        }
        // If no direction was specified then check UP, DOWN, LEFT, RIGHT
        if (directionsToCheck.size === 0) {
            directionsToCheck = new Set(SIMPLE_DIRECTIONS)
        }

        for (const direction of directionsToCheck) {

            // check that all the bracketPairs have at least one match
            let matchesAllBrackets = true
            for (const bracket of this._brackets) {
                const firstMatches = bracket.getFirstCellsInDir(direction)
                if (firstMatches.size === 0) {
                    matchesAllBrackets = false
                }
            }

            if (matchesAllBrackets) {
                // Evaluate!
                const mutators = this._brackets.map((bracket, index) => {
                    const firstMatches = new Set(bracket.getFirstCellsInDir(direction)) // Make it an Array just so we copy the elements out because Sets are mutable
                    const ret: CellMutation[][] = []
                    firstMatches.forEach(firstCell => {
                        ret.push(this._bracketPairs[index].evaluate(direction, firstCell))
                    })
                    if (process.env['NODE_ENV'] !== 'production') {
                        this.__coverageCount++
                    }
                    return _.flatten(ret)
                })
                allMutators.push(_.flatten(mutators))
                break // only evaluate the first direction that matches successfully
            }
        }
        return _.flatten(allMutators)
    }

    isLate() {
        return this._modifiers.has(RULE_MODIFIER.LATE)
    }
    isRigid() {
        return this._modifiers.has(RULE_MODIFIER.RIGID)
    }
    isAgain() {
        return this._commands.indexOf(RULE_COMMAND.AGAIN) >= 0
    }
    isVanilla() {
        return !(this.isLate() || this.isRigid() || this.isAgain())
    }

}

export class RuleBracket extends BaseForLines {
    _neighbors: RuleBracketNeighbor[]
    _hasEllipsis: boolean
    _firstCellsInEachDirection: Map<RULE_DIRECTION, Set<Cell>>

    constructor(source: IGameCode, neighbors: RuleBracketNeighbor[], hack: string) {
        super(source)
        this._neighbors = neighbors
        this._hasEllipsis = false

        // populate the cache
        this._firstCellsInEachDirection = new Map()
        for (const direction of SIMPLE_DIRECTION_DIRECTIONS) {
            this._firstCellsInEachDirection.set(direction, new Set())
        }
        this._firstCellsInEachDirection.set(RULE_DIRECTION.ACTION, new Set())

        for (let i = 0; i < neighbors.length; i++) {
            const neighbor = neighbors[i]
            if (neighbor.isEllipsis()) {
                this._hasEllipsis = true
                break
            }
        }
    }

    hasEllipsis() {
        return this._hasEllipsis
    }

    toKey() {
        return this._neighbors.map(n => n.toKey()).join('|')
    }

    subscribeToNeighborChanges() {
        this._neighbors.forEach(neighbor => {
            neighbor.addBracket(this)
        })
    }

    getFirstCellsInDir(direction: RULE_DIRECTION) {
        return this._firstCellsInEachDirection.get(direction)
    }

    addCell(neighbor: RuleBracketNeighbor, t: TileWithModifier, sprite: GameSprite, cell: Cell, wantsToMove: RULE_DIRECTION) {
        const index = this._neighbors.indexOf(neighbor)
        for (const direction of SIMPLE_DIRECTION_DIRECTIONS) {
            // check if downstream neighbors match
            if (!this.matchesDownstream(cell, index, direction)) {
                continue
            }
            // Loop Upstream
            // check the neighbors upstream of curCell
            const firstCell  = this.matchesUpstream(cell, index, direction)
            if (!firstCell) {
                continue
            }

            // Add to the set of firstNeighbors
            // We have a match. Add to the firstCells set.
            this._firstCellsInEachDirection.get(direction).add(firstCell)
        }
    }
    // updateCell(neighbor: RuleBracketNeighbor, t: TileWithModifier, sprite: GameSprite, cell: Cell, wantsToMove: RULE_DIRECTION) {
    //     this.updateCellOld(cell, sprite, t, neighbor, wantsToMove, true)
    // }
    removeCell(neighbor: RuleBracketNeighbor, t: TileWithModifier, sprite: GameSprite, cell: Cell) {
        const index = this._neighbors.indexOf(neighbor)
        // cell was removed
        for (const direction of SIMPLE_DIRECTION_DIRECTIONS) {
            // Loop Upstream
            const firstCell = this.getFirstCellToRemove(cell, index, direction)
            // Bracket might not match for all directions (likely not), so we might not find a firstCell to remove
            // But that's OK.
            if (firstCell && this._firstCellsInEachDirection.get(direction).has(firstCell)) {
                this._firstCellsInEachDirection.get(direction).delete(firstCell)
            }
        }
    }

    matchesDownstream(cell: Cell, index: number, direction: RULE_DIRECTION) {
        // Check all the neighbors and add the firstNeighbor to the set of matches for this direction
        let matched = true
        let curCell = cell
        // Loop Downstream
        // check the neighbors downstream of curCell
        for (let x = index + 1; x < this._neighbors.length; x++) {
            curCell = curCell.getNeighbor(direction)
            // TODO: Convert the neighbor check into a method
            if (curCell && (this._neighbors[x]._tilesWithModifier.length === 0 || this._neighbors[x].hasCell(curCell))) {
                // keep going
            } else {
                matched = false
                break
            }
        }
        return matched
    }

    matchesUpstream(cell: Cell, index: number, direction: RULE_DIRECTION) {
        let matched = true
        let curCell = cell
        // check the neighbors upstream of curCell
        for (let x = index - 1; x >= 0; x--) {
            curCell = curCell.getNeighbor(opposite(direction))
            if (curCell && (this._neighbors[x]._tilesWithModifier.length === 0 || this._neighbors[x].hasCell(curCell))) {
                // keep going
            } else {
                matched = false
                break
            }
        }
        return matched ? curCell : null
    }

    getFirstCellToRemove(cell: Cell, index: number, direction: RULE_DIRECTION) {
        // Loop Upstream
        // check the neighbors upstream of curCell
        let matched = true
        let curCell = cell
        // check the neighbors upstream of curCell
        for (let x = index - 1; x >= 0; x--) {
            curCell = curCell.getNeighbor(opposite(direction))
            if (curCell) {
                // keep going
            } else {
                matched = false
                break
            }
        }
        return matched ? curCell : null
    }
}

export class RuleBracketNeighbor extends BaseForLines {
    _brackets: RuleBracket[]
    _tilesWithModifier: TileWithModifier[]
    _isEllipsis: boolean
    _localCellCache: Set<Cell>

    constructor(source: IGameCode, tilesWithModifier: TileWithModifier[], isEllipsis: boolean) {
        super(source)
        this._tilesWithModifier = tilesWithModifier
        this._isEllipsis = isEllipsis

        this._localCellCache = new Set()
        this._brackets = []
    }

    toKey() {
        return this._tilesWithModifier.map(t => t.toKey()).sort().join(' ')
    }

    subscribeToTileChanges() {
        this._tilesWithModifier.forEach(t => {
            t.addRuleBracketNeighbor(this)
        })
    }

    isEllipsis() {
        return this._isEllipsis
    }

    addBracket(bracket: RuleBracket) {
        this._brackets.push(bracket)
    }

    matchesCell(cell: Cell, wantsToMove: RULE_DIRECTION) {
        let shouldMatch = true
        for (const t of this._tilesWithModifier) {
            if (!t.matchesCell2(cell, wantsToMove)) {
                shouldMatch = false
                break
            }
        }
        return shouldMatch
    }

    matchesFirstCell(cells: Iterable<Cell>, wantsToMove: RULE_DIRECTION) {
        return this.matchesCell(cells[0], wantsToMove)
    }

    addCells(t: TileWithModifier, sprite: GameSprite, cells: Iterable<Cell>, wantsToMove: RULE_DIRECTION) {
        for (const cell of cells) {
            const matchesTiles = this.matchesCell(cell, wantsToMove)
            if (matchesTiles) {
                // Commented because updates could cause the cell to already be in the cache
                //if (!this.hasCell(cell)) {
                for (const bracket of this._brackets) {
                    bracket.addCell(this, t, sprite, cell, wantsToMove)
                }
                this._localCellCache.add(cell)
                //}
            } else {
                // adding the Cell causes the set of Tiles to no longer match.
                // If it previously matched, notify the bracket that it no longer matches
                // (and delete it from our cache)
                if (this.hasCell(cell)) {
                    for (const bracket of this._brackets) {
                        bracket.removeCell(this, t, sprite, cell)
                    }
                    this._localCellCache.delete(cell)
                }
            }
        }
    }
    updateCells(t: TileWithModifier, sprite: GameSprite, cells: Iterable<Cell>, wantsToMove: RULE_DIRECTION) {
        this.addCells(t, sprite, cells, wantsToMove)
    }
    removeCells(t: TileWithModifier, sprite: GameSprite, cells: Iterable<Cell>) {
        for (const cell of cells) {
            if (this.hasCell(cell)) {
                // remove it from upstream
                for (const bracket of this._brackets) {
                    bracket.removeCell(this, t, sprite, cell)
                }
                this._localCellCache.delete(cell)
            }
        }
    }

    hasCell(cell: Cell) {
        return this._localCellCache.has(cell)
    }
}

export class TileWithModifier extends BaseForLines {
    _neighbors: RuleBracketNeighbor[]
    _modifier?: string
    _tile: IGameTile

    constructor(source: IGameCode, modifier: string, tile: IGameTile) {
        super(source)
        this._modifier = modifier
        this._tile = tile
        this._neighbors = []

        if (!this._tile) {
            console.log('TODO: Do something about ellipses')
        }

    }

    // This should only be called on Condition Brackets
    subscribeToCellChanges() {
        // subscribe this to be notified of all Sprite changes of Cells
        if (this._tile) { // grr, ellipsis hack....
            this._tile.getSprites().forEach(sprite => {
                sprite.addTileWithModifier(this)
            })
        }
    }

    toKey() {
        return `${this._modifier || ''} ${this._tile ? this._tile.getSprites().map(sprite => sprite._getName()) : '|||(notile)|||'}`
    }

    isNo() {
        return this._modifier === M_NO
    }
    isRandom() {
        return this._modifier === RULE_DIRECTION.RANDOM
    }
    isRandomDir() {
        return this._modifier === RULE_DIRECTION.RANDOMDIR
    }
    getDirectionActionOrStationary(): RULE_DIRECTION {
        let direction
        switch (this._modifier) {
            case RULE_DIRECTION.RANDOMDIR:
                switch (nextRandom(4)) {
                    case 0:
                        direction = RULE_DIRECTION.UP
                        break
                    case 1:
                        direction = RULE_DIRECTION.DOWN
                        break
                    case 2:
                        direction = RULE_DIRECTION.LEFT
                        break
                    case 3:
                        direction = RULE_DIRECTION.RIGHT
                        break
                    default:
                        throw new Error(`BUG: invalid random number chosen`)
                }
            case RULE_DIRECTION.UP:
                direction = RULE_DIRECTION.UP
                break
            case RULE_DIRECTION.DOWN:
                direction = RULE_DIRECTION.DOWN
                break
            case RULE_DIRECTION.LEFT:
                direction = RULE_DIRECTION.LEFT
                break
            case RULE_DIRECTION.RIGHT:
                direction = RULE_DIRECTION.RIGHT
                break
            case RULE_DIRECTION.ACTION:
                direction = RULE_DIRECTION.ACTION
                break
            case RULE_DIRECTION.STATIONARY:
                // if the cell had a wantsToMove, then clear it
                direction = RULE_DIRECTION.STATIONARY
                break
            case undefined:
                direction = null
                break
            default:
                throw new Error(`BUG: unsupported rule direction modifier "${this._modifier}"`)
        }
        return direction
    }

    matchesCell(cell: Cell) {
        // TODO: Check if cell is STATIONARY and Tile is STATIONARY (right now null means both STATIONARY and don't-care)
        if (this._modifier && !SUPPORTED_CELL_MODIFIERS.has(this._modifier)) {
            return false // Modifier not supported yet
        }
        const hasTile = this._tile && this._tile.matchesCell(cell)
        return this.isNo() != hasTile
    }
    matchesFirstCell(cells: Iterable<Cell>) {
        return this.matchesCell(cells[0])
    }
    matchesCell2(cell: Cell, wantsToMove: RULE_DIRECTION) {
        if (this._modifier === 'STATIONARY' && wantsToMove) {
            return false
        }
        if (this._modifier && !SUPPORTED_CELL_MODIFIERS.has(this._modifier)) {
            return false // Modifier not supported yet
        }
        const hasTile = this._tile && this._tile.matchesCell(cell)
        let matchesDirection = true
        if (RULE_DIRECTION.STATIONARY === RULE_DIRECTION[this._modifier]) {
            // matchesDirection = cell.wantsToMoveTo(this._tile, relativeDirectionToAbsolute(direction, RULE_DIRECTION[this._modifier]))
            matchesDirection = !wantsToMove
        }
        if (this.isNo()) {
            return !(hasTile && matchesDirection)
        } else {
            return hasTile && matchesDirection
        }
    }

    addRuleBracketNeighbor(neighbor: RuleBracketNeighbor) {
        this._neighbors.push(neighbor)
    }
    addCells(sprite: GameSprite, cells: Iterable<Cell>, wantsToMove: RULE_DIRECTION) {
        // Cells all have the same sprites, so if the 1st matches, they all do
        if (this.matchesFirstCell(cells)) {
            for (const neighbor of this._neighbors) {
                neighbor.addCells(this, sprite, cells, wantsToMove)
            }
        }
    }
    updateCells(sprite: GameSprite, cells: Iterable<Cell>, wantsToMove: RULE_DIRECTION) {
        // Cells all have the same sprites, so if the 1st matches, they all do
        if (this.matchesFirstCell(cells)) {
            for (const neighbor of this._neighbors) {
                neighbor.updateCells(this, sprite, cells, wantsToMove)
            }
        }
    }
    removeCells(sprite: GameSprite, cells: Iterable<Cell>) {
        // Cells all have the same sprites, so if the 1st matches, they all do
        if (this.matchesFirstCell(cells)) {
            for (const neighbor of this._neighbors) {
                neighbor.addCells(this, sprite, cells, null/*STATIONARY*/)
            }
        } else {
            for (const neighbor of this._neighbors) {
                neighbor.removeCells(this, sprite, cells)
            }
        }
    }
}

// Extend RuleBracketNeighbor so that NeighborPair doesn't break
export class HackNode extends RuleBracketNeighbor {
    fields: object

    // These should be addressed as we write the interpreter
    constructor(source: IGameCode, fields: object) {
        super(source, [], false)
        this.fields = fields
    }

    isEllipsis() {
        return false
    }
}

export interface IRule extends IGameNode {
    evaluate: () => CellMutation[]
}

export class GameRuleLoop extends BaseForLines implements IRule {
    _rules: GameRule[]

    constructor(source: IGameCode, rules: GameRule[]) {
        super(source)
        this._rules = rules
    }

    evaluate() {
        return [] // Not implemented yet
        // return getMatchedMutatorsHelper(this._rules, cell)
    }

}

export class GameRuleGroup extends GameRuleLoop {
    // do we really need this class?
}

const M_STATIONARY = 'STATIONARY'
const M_NO = 'NO'
const SUPPORTED_CELL_MODIFIERS = new Set([M_STATIONARY, M_NO])
const SUPPORTED_RULE_MODIFIERS = new Set([
    RULE_MODIFIER.UP,
    RULE_MODIFIER.DOWN,
    RULE_MODIFIER.LEFT,
    RULE_MODIFIER.RIGHT,
    RULE_MODIFIER.HORIZONTAL,
    RULE_MODIFIER.VERTICAL,
    RULE_MODIFIER.ORTHOGONAL
])

function relativeDirectionToAbsolute(currentDirection: RULE_DIRECTION, tileModifier: string) {
    let currentDir
    switch (currentDirection) {
        case RULE_DIRECTION.RIGHT:
            currentDir = 0
            break
        case RULE_DIRECTION.UP:
            currentDir = 1
            break
        case RULE_DIRECTION.LEFT:
            currentDir = 2
            break
        case RULE_DIRECTION.DOWN:
            currentDir = 3
            break
        default:
            throw new Error(`BUG! Invalid rule direction "${currentDirection}`)
    }

    switch (tileModifier) {
        case RULE_DIRECTION.RIGHT:
            currentDir += 0
            break
        case RULE_DIRECTION.UP:
            currentDir += 1
            break
        case RULE_DIRECTION.LEFT:
            currentDir += 2
            break
        case RULE_DIRECTION.DOWN:
            currentDir += 3
            break
    }
    switch (currentDir % 4) {
        case 0:
            return RULE_DIRECTION.RIGHT
        case 1:
            return RULE_DIRECTION.UP
        case 2:
            return RULE_DIRECTION.LEFT
        case 3:
            return RULE_DIRECTION.DOWN
        default:
            throw new Error(`BUG! Incorrectly computed rule direction "${currentDirection}" "${tileModifier}"`)
    }
}