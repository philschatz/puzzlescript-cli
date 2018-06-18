import * as _ from 'lodash'
import { EventEmitter2, Listener } from 'eventemitter2'
import { GameData } from './models/game'
import { LevelMap } from './models/level';
import { GameSprite, GameLegendTileSimple, IGameTile } from './models/tile'
import { GameRule, CellMutation, IRule, IMutation } from './models/rule'
import { RULE_MODIFIER, nextRandom, setAddAll, RULE_DIRECTION_ABSOLUTE } from './util'
import { RULE_DIRECTION } from './enums';
import { AbstractCommand, COMMAND_TYPE } from './models/command';
import { GameSound } from './models/sound';
import { CollisionLayer } from './models/collisionLayer';

const MAX_REPEATS = 10


// This Object exists so the UI has something to bind to
export class Cell {
    _engine: LevelEngine
    // In the original implementation, wantsToMove is stored for the collisionLayer,
    // not on the sprite. Since we do not do that, we have to transfer the wantsToMove
    // when a sprite in a collisionLayer is swapped with another sprite in the same layer.
    // TODO: Store wantsToMove information using the collisionLayer as a key rather than the sprite.
    _collisionLayerWantsToMove: RULE_DIRECTION_ABSOLUTE[]
    _cacheSpritesByCollisionLayer: GameSprite[]
    rowIndex: number
    colIndex: number

    constructor(engine: LevelEngine, sprites: Set<GameSprite>, rowIndex: number, colIndex: number) {
        this._engine = engine
        this.rowIndex = rowIndex
        this.colIndex = colIndex
        this._collisionLayerWantsToMove = []
        this._cacheSpritesByCollisionLayer = []

        for (const sprite of sprites) {
            this._setWantsToMove(sprite, RULE_DIRECTION_ABSOLUTE.STATIONARY)
        }

    }
    _setWantsToMove(sprite: GameSprite, wantsToMove: RULE_DIRECTION_ABSOLUTE) {
        const collisionLayer = sprite.getCollisionLayerNum()
        const didActuallyChangeDir = this._collisionLayerWantsToMove[collisionLayer] !== wantsToMove
        const didActuallyChangeSprite = this._cacheSpritesByCollisionLayer[collisionLayer] !== sprite
        this._collisionLayerWantsToMove[collisionLayer] = wantsToMove
        this._cacheSpritesByCollisionLayer[collisionLayer] = sprite
        return didActuallyChangeSprite || didActuallyChangeDir
    }
    _deleteWantsToMove(sprite: GameSprite) {
        // There may be other sprites in the same ... oh wait, no that's not possible.
        const collisionLayer = sprite.getCollisionLayer()
        const collisionLayerNum = sprite.getCollisionLayerNum()
        const didActuallyChange = !!this._cacheSpritesByCollisionLayer[collisionLayerNum]
        this._collisionLayerWantsToMove[collisionLayerNum] = null
        this._cacheSpritesByCollisionLayer[collisionLayerNum] = null
        return didActuallyChange
    }
    setWantsToMoveCollisionLayer(collisionLayer: CollisionLayer, wantsToMove: RULE_DIRECTION_ABSOLUTE) {
        const c = collisionLayer.id
        // Check that there is a sprite for this collision layer
        const sprite = this._cacheSpritesByCollisionLayer[c]
        if (!sprite) {
            debugger
            throw new Error(`BUG: No sprite for collision layer ${c}. Cannot set direction`)
        }
        const didActuallyChange = this._collisionLayerWantsToMove[c] !== wantsToMove
        this._collisionLayerWantsToMove[c] = wantsToMove
        sprite.addCell(this, wantsToMove)
        return didActuallyChange
    }
    deleteWantsToMoveCollisionLayer(collisionLayer: CollisionLayer) {
        const c = collisionLayer.id
        // Check that there is a sprite for this collision layer
        const sprite = this._cacheSpritesByCollisionLayer[c]
        if (!sprite) {
            debugger
            throw new Error(`BUG: No sprite for collision layer ${c}. Cannot delete direction`)
        }
        const didActuallyChange = this._collisionLayerWantsToMove[c] !== null
        this._collisionLayerWantsToMove[c] = null
        sprite.removeCell(this)
        return didActuallyChange
    }
    getSpriteByCollisionLayer(collisionLayer: CollisionLayer) {
        return this._cacheSpritesByCollisionLayer[collisionLayer.id]
    }
    getSprites() {
        // Just pull out the sprite, not the wantsToMoveDir
        return this._cacheSpritesByCollisionLayer
        .filter(s => !!s)
        .reverse()
    }
    getSpritesAsSet() {
        // Just pull out the sprite, not the wantsToMoveDir
        // TODO: Speed this up by creating a cache
        return new Set(this._cacheSpritesByCollisionLayer.filter(s => !!s))
    }
    getSpriteAndWantsToMoves() {
        // Just pull out the sprite, not the wantsToMoveDir
        // Retur na new set so we can mutate it later
        const map = new Map()
        for (let i = 0; i < this._cacheSpritesByCollisionLayer.length; i++) {
            if (this._cacheSpritesByCollisionLayer[i]) {
                map.set(this._cacheSpritesByCollisionLayer[i], this._collisionLayerWantsToMove[i])
            }
        }
        return map
    }
    hasSprite(sprite: GameSprite) {
        return this._cacheSpritesByCollisionLayer[sprite.getCollisionLayerNum()] === sprite
    }

    _getRelativeNeighbor(y: number, x: number) {
        const row = this._engine.currentLevel[this.rowIndex + y]
        if (!row) return null
        return row[this.colIndex + x]
    }
    getNeighbor(direction: string) {
        switch (direction) {
            case RULE_MODIFIER.UP:
                return this._getRelativeNeighbor(-1, 0)
            case RULE_MODIFIER.DOWN:
                return this._getRelativeNeighbor(1, 0)
            case RULE_MODIFIER.LEFT:
                return this._getRelativeNeighbor(0, -1)
            case RULE_MODIFIER.RIGHT:
                return this._getRelativeNeighbor(0, 1)
            default:
                debugger
                throw new Error(`BUG: Unsupported direction "${direction}"`)
        }
    }
    wantsToMoveTo(tile: IGameTile, absoluteDirection: RULE_DIRECTION_ABSOLUTE) {
        let wantsToMove = false
        tile.getSprites().forEach(sprite => {
            const directionForSprite = this.directionForSprite(sprite)
            if (directionForSprite && directionForSprite === absoluteDirection) {
                wantsToMove = true
            }
        })
        return wantsToMove
    }
    getWantsToMove(sprite: GameSprite) {
        const wantsToMove = this._collisionLayerWantsToMove[sprite.getCollisionLayerNum()]
        if (wantsToMove) {
            return RULE_DIRECTION_ABSOLUTE[wantsToMove]
        } else {
            return null
        }
    }
    getWantsToMoveByCollisionLayer(collisionLayer: CollisionLayer) {
        return this._collisionLayerWantsToMove[collisionLayer.id]
    }
    directionForSprite(sprite: GameSprite) {
        return this._collisionLayerWantsToMove[sprite.getCollisionLayerNum()]
    }
    hasCollisionWithSprite(otherSprite: GameSprite) {
        return !!this._collisionLayerWantsToMove[otherSprite.getCollisionLayerNum()]
    }
    clearWantsToMove(sprite: GameSprite) {
        this._setWantsToMove(sprite, RULE_DIRECTION_ABSOLUTE.STATIONARY)
        sprite.updateCell(this, RULE_DIRECTION_ABSOLUTE.STATIONARY)
    }
    addSprite(sprite: GameSprite, wantsToMove?: RULE_DIRECTION_ABSOLUTE) {
        let didActuallyChange = false
        // If we already have a sprite in that collision layer then we need to remove it
        const prevSprite = this.getSpriteByCollisionLayer(sprite.getCollisionLayer())
        const prevWantsToMove = this.getWantsToMoveByCollisionLayer(sprite.getCollisionLayer())
        if (prevSprite && prevSprite !== sprite) {
            this.removeSprite(prevSprite)
        }
        if (wantsToMove) {
            didActuallyChange = this._setWantsToMove(sprite, wantsToMove)
        } else if (!this.hasSprite(sprite)) {
            wantsToMove = prevWantsToMove || RULE_DIRECTION_ABSOLUTE.STATIONARY // try to preserve the wantsToMove
            didActuallyChange = this._setWantsToMove(sprite, wantsToMove)
        }
        sprite.addCell(this, wantsToMove)
        return didActuallyChange
    }
    removeSprite(sprite: GameSprite) {
        const didActuallyChange = this._deleteWantsToMove(sprite)
        sprite.removeCell(this)
        return didActuallyChange
    }
    removeSprites(sprites: Iterable<GameSprite>) {
        for (const sprite of sprites) {
            this.removeSprite(sprite)
        }
    }
    setWantsToMove(tile: IGameTile, wantsToMove: RULE_DIRECTION_ABSOLUTE) {
        for (const sprite of tile.getSprites()) {
            if (this.hasSprite(sprite)) {
                this.addSprite(sprite, wantsToMove)
            }
        }
    }
    toString() {
        return `Cell [${this.rowIndex}][${this.colIndex}] ${[...this.getSpriteAndWantsToMoves().entries()].map(([sprite, wantsToMove]) => `${wantsToMove} ${sprite.getName()}`).join(' ')}`
    }
}

export class LevelEngine extends EventEmitter2 {
    gameData: GameData
    currentLevel: Cell[][]
    _pendingPlayerWantsToMove: RULE_DIRECTION_ABSOLUTE
    _hasAgainThatNeedsToRun: boolean

    constructor(gameData: GameData) {
        super()
        this.gameData = gameData
        this._hasAgainThatNeedsToRun = false
    }

    setLevel(levelNum: number) {
        this.gameData.clearCaches()

        const level = this.gameData.levels[levelNum]
        if (!level) {
            throw new Error(`Invalid levelNum: ${levelNum}`)
        }
        if (process.env['NODE_ENV'] !== 'production') {
            level.__coverageCount++
        }
        // Clone the board because we will be modifying it
        this.currentLevel = level.getRows().map((row, rowIndex) => {
            return row.map((col, colIndex) => new Cell(this, new Set(col.getSprites()), rowIndex, colIndex))
        })

        // link up all the cells. Loop over all the sprites
        // in case they are NO tiles (so the cell is included)
        const batchCells: Map<string, Cell[]> = new Map()
        function spriteSetToKey(sprites: Set<GameSprite>) {
            const key = []
            for (const spriteName of [...sprites].map(sprite => sprite._name).sort()) {
                key.push(spriteName)
            }
            return key.join(' ')
        }
        const allCells = this.getCells()
        // But first, fill up any empty condition brackets with ALL THE CELLS
        for (const rule of this.gameData.rules) {
            rule.addCellsToEmptyRules(allCells)
        }
        for (const cell of allCells) {
            const key = spriteSetToKey(cell.getSpritesAsSet())
            if (!batchCells.has(key)) {
                batchCells.set(key, [])
            }
            batchCells.get(key).push(cell)
        }

        // Print progress while loading up the Cells
        let i = 0
        for (const [key, cells] of batchCells) {
            if ((batchCells.size > 100 && i % 10 === 0) || cells.length > 100) {
                this.emit('loading-cells', {
                    cellStart: i,
                    cellEnd: i + cells.length,
                    cellTotal: allCells.length,
                    key: key
                })
            }
            // All Cells contain the same set of sprites so just pull out the 1st one
            for (const sprite of this.gameData.objects) {
                const cellSprites = cells[0].getSpritesAsSet()
                const hasSprite = cellSprites.has(sprite)
                if (hasSprite || sprite.hasNegationTile()) {
                    if (hasSprite) {
                        sprite.addCells(cells, RULE_DIRECTION_ABSOLUTE.STATIONARY)
                    } else {
                        sprite.removeCells(cells)
                    }
                }
            }
            i += cells.length
        }

        // Return the cells so the UI can listen to when they change
        return this.getCells()
    }

    getCells() {
        return _.flatten(this.currentLevel)
    }

    toSnapshot() {
        return this.currentLevel.map(row => {
            return row.map(cell => {
                const ret = []
                cell.getSpriteAndWantsToMoves().forEach((wantsToMove, sprite) => {
                    ret.push(`${wantsToMove} ${sprite._name}`)
                })
                return ret
            })
        })
    }

    tickUpdateCells() {
        if (process.env['LOG_LEVEL'] === 'debug') {
            console.error(`applying rules`)
        }
        return this._tickUpdateCells(this.gameData.rules.filter(r => !r.isLate()))
    }

    tickUpdateCellsLate() {
        if (process.env['LOG_LEVEL'] === 'debug') {
            console.error(`applying late rules`)
        }
        return this._tickUpdateCells(this.gameData.rules.filter(r => r.isLate()))
    }

    _tickUpdateCells(rules: Iterable<IRule>) {
        const changedMutations: Set<IMutation> = new Set()
        const evaluatedRules: IRule[] = []
        let ruleIndex = 0
        for (const rule of rules) {
            const cellMutations = rule.evaluate()
            if (cellMutations.length > 0) {
                evaluatedRules.push(rule)
            }
            for (const mutation of cellMutations) {
                changedMutations.add(mutation)
            }
            ruleIndex++ // Just for debugging
        }

        // We may have mutated the same cell 4 times (e.g. [Player]->[>Player]) so consolidate
        const changedCells = new Set<Cell>()
        const commands = new Set<AbstractCommand>()
        let didSomeSpriteChange = false
        for (const mutation of changedMutations) {
            if (mutation.getDidSpritesChange()) {
                didSomeSpriteChange = true
            }
            if (mutation.hasCell()) {
                changedCells.add(mutation.getCell())
            } else {
                commands.add(mutation.getCommand())
            }
            // if (!changedCells.has(mutation.cell)) {
            //     changedCells.set(mutation.cell, mutation.didSpritesChange)
            // }
        }
        return {evaluatedRules: evaluatedRules, changedCells: changedCells, commands: commands, didSomeSpriteChange: didSomeSpriteChange}
    }

    tickMoveSprites(changedCells: Set<Cell>) {
        let movedCells: Set<Cell> = new Set()
        // Loop over all the cells, see if a Rule matches, apply the transition, and notify that cells changed
        let somethingChanged
        do {
            somethingChanged = false
            for (const cell of changedCells) {
                for (let [sprite, wantsToMove] of cell.getSpriteAndWantsToMoves()) {

                    if (wantsToMove !== RULE_DIRECTION_ABSOLUTE.STATIONARY) {
                        if (wantsToMove === RULE_DIRECTION.ACTION) {
                            // just clear the wantsToMove flag
                            somethingChanged = true
                            cell.clearWantsToMove(sprite)
                        } else if (wantsToMove === RULE_DIRECTION.STATIONARY) {
                            somethingChanged = true
                            cell.clearWantsToMove(sprite)
                        } else {
                            if (wantsToMove === RULE_DIRECTION.RANDOMDIR) {
                                const rand = nextRandom(4)
                                switch (rand) {
                                    case 0:
                                        wantsToMove = RULE_DIRECTION.UP
                                        break
                                    case 1:
                                        wantsToMove = RULE_DIRECTION.DOWN
                                        break
                                    case 2:
                                        wantsToMove = RULE_DIRECTION.LEFT
                                        break
                                    case 3:
                                        wantsToMove = RULE_DIRECTION.RIGHT
                                        break
                                    default:
                                        throw new Error(`BUG: Random number generator yielded something other than 0-3. "${rand}"`)
                                }
                            }
                            if (wantsToMove === RULE_DIRECTION.RANDOM) {
                                throw new Error('BUG: should have converted RANDOM to something else earlier')
                            }
                            const neighbor = cell.getNeighbor(wantsToMove)
                            // Make sure
                            if (neighbor && !neighbor.hasCollisionWithSprite(sprite)) {
                                cell.removeSprite(sprite)
                                neighbor.addSprite(sprite, RULE_DIRECTION_ABSOLUTE.STATIONARY)
                                movedCells.add(neighbor)
                                movedCells.add(cell)
                                somethingChanged = true
                                // Don't delete until we are sure none of the sprites want to move
                                // changedCells.delete(cell)
                            } else {
                                // Clear the wantsToMove flag LATER if we hit a wall (a sprite in the same collisionLayer) or are at the end of the map
                                // We do this later because we are looping as long as something changed
                                // cell.clearWantsToMove(sprite)
                            }
                        }
                    }
                }
            }
        } while (somethingChanged)

        // Clear the wantsToMove from all remaining cells
        for (const cell of changedCells) {
            for (const [sprite, wantsToMove] of cell.getSpriteAndWantsToMoves()) {
                cell.clearWantsToMove(sprite)
            }
        }
        return movedCells
    }

    tickNormal() {
        let changedCellMutations = new Set()
        if (this._pendingPlayerWantsToMove) {
            if (process.env['LOG_LEVEL'] === 'debug') {
                console.error(`Turn starts with input of ${this._pendingPlayerWantsToMove.toLowerCase()}.`)
            }
            const t = this.gameData.getPlayer()
            for (const cell of t.getCellsThatMatch()) {
                for (const sprite of t.getSpritesThatMatch(cell)) {
                    cell.addSprite(sprite, this._pendingPlayerWantsToMove)
                    changedCellMutations.add(cell)
                }
            }
            this._pendingPlayerWantsToMove = null
        } else {
            if (process.env['LOG_LEVEL'] === 'debug') {
                console.error(`Turn starts with no input.`)
            }
        }

        const {changedCells: changedCellMutations2, evaluatedRules, commands, didSomeSpriteChange} = this.tickUpdateCells()
        changedCellMutations = setAddAll(changedCellMutations, changedCellMutations2)

        // Continue evaluating again rules only when some sprites have changed
        // The didSpritesChange logic is not correct.
        // a rule might add a sprite, and then another rule might remove a sprite.
        // We need to compare the set of sprites before and after ALL rules ran.
        // This will likely be implemented as part of UNDO or CHECKPOINT.
        const movedCells = this.tickMoveSprites(new Set<Cell>(changedCellMutations.keys()))
        const {changedCells: changedCellsLate, evaluatedRules: evaluatedRulesLate, commands: commandsLate} = this.tickUpdateCellsLate()
        this._hasAgainThatNeedsToRun = !![...commands, ...commandsLate].filter(c => c.getType() === COMMAND_TYPE.AGAIN)[0]
        return {
            changedCells: setAddAll(setAddAll(changedCellMutations, changedCellsLate), movedCells),
            evaluatedRules: evaluatedRules.concat(evaluatedRulesLate),
            commands: commands
        }
    }

    tick() {
        if (process.env['LOG_LEVEL'] === 'debug') {
            console.error(``)
            console.error(`=======================`)
        }

        let ret : { changedCells: Set<Cell>, evaluatedRules: IRule[] , commands: Set<AbstractCommand>}
        if (this._hasAgainThatNeedsToRun) {
            // run the AGAIN rules
            this._hasAgainThatNeedsToRun = false // let the .tick() make it true
            ret = this.tickNormal()
        } else {
            ret = this.tickNormal()
        }
        // TODO: Handle the commands like RESTART, CANCEL, WIN at this point
        let soundToPlay: GameSound = null
        let hasWinCommand = false
        for (const command of ret.commands) {
            switch (command.getType()) {
                case COMMAND_TYPE.SFX:
                    soundToPlay = command.getSound()
                    break
                case COMMAND_TYPE.WIN:
                    hasWinCommand = true
                    break
                default:
                    // console.error(`BUG: Unsupported command "${command.getType()}"`)
            }
        }
        if (process.env['LOG_LEVEL'] === 'debug') {
            console.error(`checking win condition.`)
        }
        if (this._hasAgainThatNeedsToRun) {
            if (process.env['LOG_LEVEL'] === 'debug') {
                console.error(`AGAIN command executed, with changes detected - will execute another turn.`)
            }
        }

        return {
            changedCells: new Set(ret.changedCells.keys()),
            soundToPlay,
            isWinning: hasWinCommand || this.isWinning()
        }
    }

    hasAgain() {
        return this._hasAgainThatNeedsToRun
    }

    isWinning() {
        let conditionsSatisfied = this.gameData.winConditions.length > 0 // true
        this.gameData.winConditions.forEach(winCondition => {
            if (!winCondition.isSatisfied(this.getCells())) {
                conditionsSatisfied = false
            }
        })
        return conditionsSatisfied
    }

    press(direction: RULE_DIRECTION_ABSOLUTE) {
        // Should disable keypresses if `AGAIN` is running.
        // It is commented because the didSpritesChange logic is not correct.
        // a rule might add a sprite, and then another rule might remove a sprite.
        // We need to compare the set of sprites before and after ALL rules ran.
        // This will likely be implemented as part of UNDO or CHECKPOINT.
        // if (!this.hasAgain()) {
        this._pendingPlayerWantsToMove = direction
        // }
    }
    pressRestart(levelNum) {
        this.setLevel(levelNum)
    }
    pressUndo() { }
}

export type LoadingCellsEvent = {
    cellStart: number,
    cellEnd: number,
    cellTotal: number,
    key: string
}
export interface LoadingProgressHandler extends Listener {
    (info: LoadingCellsEvent): void;
}

export class GameEngine {
    _levelEngine: LevelEngine
    _currentLevelNum: number
    _events: Map<string, LoadingProgressHandler []>
    _isFirstTick: boolean
    constructor() {
        this._events = new Map()
    }
    on(eventName: string, handler: LoadingProgressHandler) {
        if (!this._events.has(eventName)) {
            this._events.set(eventName, [])
        }
        this._events.get(eventName).push(handler)
    }
    setGame(gameData: GameData) {
        this._levelEngine = new LevelEngine(gameData)
        // register event handlers (like for the loading progress bar)
        for (const [eventName, handlers] of this._events.entries()) {
            for (const handler of handlers) {
                this._levelEngine.on(eventName, handler)
            }
        }
    }
    getGameData() {
        return this._levelEngine.gameData
    }
    getCurrentLevel() {
        return this._levelEngine.currentLevel
    }
    getCurrentLevelNum() {
        return this._currentLevelNum
    }
    hasAgain() {
        return this._levelEngine.hasAgain()
    }
    setLevel(levelNum: number) {
        if (this.getGameData().levels[levelNum].isMap()) {
            this._isFirstTick = true
            this._levelEngine.setLevel(levelNum)
        } else {
            // TODO: no need to set the levelEngine when the current level is a Message
        }
        this._currentLevelNum = levelNum
    }
    tick() {
        const hasAgain = this._levelEngine.hasAgain()
        if (this._levelEngine.gameData.metadata.run_rules_on_level_start && this._isFirstTick) {
            // don't cancel early
        } else if (!hasAgain && !(this._levelEngine.gameData.metadata.realtime_interval || this._levelEngine._pendingPlayerWantsToMove)) {
            // check if the `require_player_movement` flag is set in the game
            return {
                changedCells: new Set(),
                soundToPlay: null,
                didWinGame: false,
                didLevelChange: false,
                wasAgainTick: false
            }
        }

        const {changedCells, soundToPlay, isWinning} = this._levelEngine.tick()
        this._isFirstTick = false

        let didWinGame = false
        if (isWinning) {
            if (this._currentLevelNum === this._levelEngine.gameData.levels.length - 1) {
                didWinGame = true
            } else {
                this.setLevel(this._currentLevelNum + 1)
            }
        }
        return {
            changedCells,
            soundToPlay,
            didWinGame,
            didLevelChange: isWinning,
            wasAgainTick: hasAgain
        }
    }

    press(direction: RULE_DIRECTION_ABSOLUTE) {
        return this._levelEngine.press(direction)
    }
    pressUp() {
        this._levelEngine.press(RULE_DIRECTION_ABSOLUTE.UP)
    }
    pressDown() {
        this._levelEngine.press(RULE_DIRECTION_ABSOLUTE.DOWN)
    }
    pressLeft() {
        this._levelEngine.press(RULE_DIRECTION_ABSOLUTE.LEFT)
    }
    pressRight() {
        this._levelEngine.press(RULE_DIRECTION_ABSOLUTE.RIGHT)
    }
    pressAction() {
        this._levelEngine.press(RULE_DIRECTION_ABSOLUTE.ACTION)
    }

    pressRestart() {
        this._isFirstTick = true
        this._levelEngine.pressRestart(this._currentLevelNum)
    }
    pressUndo() {
        this._levelEngine.pressUndo()
    }

}