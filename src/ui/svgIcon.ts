import { Cell } from '..'
import { CellSaveState } from '../engine'
import { IColor } from '../models/colors'
import { A11Y_MESSAGE } from '../models/rule'
import { GameSprite } from '../models/tile'
import { Soundish } from '../parser/astTypes'
import { _flatten, Cellish, GameEngineHandler, INPUT_BUTTON, Optional } from '../util'
import BaseUI from './base'

export class SvgIconUi extends BaseUI implements GameEngineHandler {

    // onGameChange(gameData: GameData) { throw new Error('BUG: Not implemented') }
    public onPress(dir: INPUT_BUTTON) { throw new Error('BUG: Not implemented') }
    public onMessage(msg: string): Promise<any> { throw new Error('BUG: Not implemented') }
    public onLevelLoad(level: number, newLevelSize: Optional<{rows: number, cols: number}>) { /*do nothing*/ }
    // onLevelChange(level: number, cells: Optional<Cellish[][]>, message: Optional<string>) { throw new Error('BUG: Not implemented') }
    public onWin(): Promise<any> { throw new Error('BUG: Not implemented') }
    public onSound(sound: Soundish): Promise<any> { throw new Error('BUG: Not implemented') }
    public onTick(changedCells: Set<Cellish>, checkpoint: Optional<CellSaveState>, hasAgain: boolean, a11yMessages: A11Y_MESSAGE<Cell, GameSprite>[]) { throw new Error('BUG: Not implemented') }
    public onPause() { throw new Error('BUG: Not implemented') }
    public onResume() { throw new Error('BUG: Not implemented') }

    public getSvg() {
        const colorCount = new Map<string, number>()
        const height = this.renderedPixels.length
        let width = 0
        for (const row of this.renderedPixels) {
            width = Math.max(width, row.length)
        }

        const pixelStrs: string[] = []
        let y = 0
        for (const row of this.renderedPixels) {
            let x = 0
            for (const pixel of row) {
                if (pixel) {
                    colorCount.set(pixel.hex, colorCount.get(pixel.hex) || 0 + 1)
                    pixelStrs.push(`    <rect height="10" width="10" x="${x}0" y="${y}0" style="fill:${pixel.hex}"/>`)
                }

                x += 1
            }

            y += 1
        }

        const popularColors = [...colorCount.entries()]
        .sort(([_A, countA], [_B, countB]) => countB - countA)
        .slice(0, 3)
        .map(([hex]) => hex)

        return {
            popularColors,
            svg: `<?xml version="1.0" encoding="UTF-8" standalone="no"?>

<svg xmlns="http://www.w3.org/2000/svg"
    width="${width}0"
    height="${height}0"
    viewBox="0 0 ${width}0 ${height}0"
    version="1.1">
    <g>
    ${pixelStrs.join('\n')}
    </g>
</svg>
        `}

    }

    protected renderLevelScreen(levelRows: Cellish[][], renderScreenDepth: number) {
        this.drawCells(_flatten(levelRows), false, renderScreenDepth)
    }
    protected setPixel(x: number, y: number, hex: string, fgHex: Optional<string>, chars: string) {
        if (!this.renderedPixels[y]) {
            this.renderedPixels[y] = []
        }
        const onScreenPixel = this.renderedPixels[y][x]
        if (!onScreenPixel || onScreenPixel.hex !== hex || onScreenPixel.chars !== chars) {
            this.renderedPixels[y][x] = { hex, chars }
        }
    }
    protected checkIfCellCanBeDrawnOnScreen(cellStartX: number, cellStartY: number) { return true }
    protected getMaxSize() { return { columns: 1000, rows: 1000 } }
    protected drawCellsAfterRecentering(cells: Iterable<Cellish>, renderScreenDepth: number) {
        for (const cell of cells) {
            this._drawCell(cell, renderScreenDepth)
        }
    }

    private _drawCell(cell: Cellish, renderScreenDepth: number = 0) {
        if (!this.gameData) {
            throw new Error(`BUG: gameData was not set yet`)
        }
        if (!this.hasVisualUi) {
            throw new Error(`BUG: Should not get to this point`)
        }

        const { isOnScreen, cellStartX, cellStartY } = this.cellPosToXY(cell)

        if (!isOnScreen) {
            return // no need to render because it is off-screen
        }

        const pixels: IColor[][] = this.getPixelsForCell(cell)
        pixels.forEach((spriteRow, spriteRowIndex) => {
            spriteRow.forEach((spriteColor: IColor, spriteColIndex) => {
                if (!this.gameData) {
                    throw new Error(`BUG: gameData was not set yet`)
                }
                const x = cellStartX + spriteColIndex
                const y = cellStartY + spriteRowIndex

                let color: Optional<IColor> = null

                if (spriteColor) {
                    if (!spriteColor.isTransparent()) {
                        color = spriteColor
                    } else if (this.gameData.metadata.backgroundColor) {
                        color = this.gameData.metadata.backgroundColor
                    } else {
                        color = null
                    }
                }

                if (color) {
                    const hex = color.toHex()
                    const fgHex = null
                    const chars = ' '
                    this.setPixel(x, y, hex, fgHex, chars)
                }
            })
        })
    }
}
