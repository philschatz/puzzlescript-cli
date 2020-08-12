// tslint:disable:no-console
import chalk from 'chalk'
import commander from 'commander'
import fontAscii from 'font-ascii'
import { createReadStream, existsSync, readFileSync, writeFileSync } from 'fs'
import glob from 'glob'
import * as inquirer from 'inquirer'
import PromptModule from 'inquirer-autocomplete-prompt'
import * as path from 'path'
import pify from 'pify'
import * as supportsColor from 'supports-color'

import { ensureDir, ensureDirSync } from 'fs-extra'
import { closeSounds, GameData, GameEngine, ILoadingCellsEvent, Optional, Parser, RULE_DIRECTION } from '..'
import { logger } from '../logger'
import { LEVEL_TYPE } from '../parser/astTypes'
import { saveCoverageFile } from '../recordCoverage'
import TerminalUI, { getTerminalSize } from '../ui/terminal'
import { _flatten, EmptyGameEngineHandler, INPUT_BUTTON } from '../util'
import SOLVED_GAMES from './solvedGames'
import TITLE_FONTS from './titleFonts'

export interface IGameRecording {
    version: number,
    solutions: ILevelRecording[]
}
export interface ILevelRecording {
    partial?: string,
    solution?: string
}
interface IPackage {
    version: string,
    homepage: string
}
enum CLI_SPRITE_SIZE {
    LARGE = 'large',
    SMALL = 'small'
}
interface IGameInfo { id: string, title: string, filePath: string }
interface ISaveFile { version: number, solutions: { solution?: string, partial?: string, snapshot?: {tickNum: number, cellState: string[][][]} }[] }
interface ICliOptions {
    version: string,
    ui: boolean,
    game: string | undefined,
    size: CLI_SPRITE_SIZE | undefined,
    new: true | undefined,
    level: number | undefined,
    resume: boolean | undefined,
}

// Use require instead of import so we can load JSON files
const pkg: IPackage = require('../../package.json') as IPackage // tslint:disable-line:no-var-requires

let SOLUTION_ROOT = path.join(__dirname, '../../game-solutions/')
if (!existsSync(SOLUTION_ROOT)) {
    const homeDir = process.env.HOME
    if (!homeDir) {
        throw new Error(`BUG: Could not determine home directory to save game solutions to`)
    }
    SOLUTION_ROOT = path.join(homeDir, '.local/puzzlescript/solutions')
}

async function sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

function first2Lines(filePath: string) {

    const lineEnding = '\n'
    return new Promise<string>((resolve, reject) => {
        const rs = createReadStream(filePath, { encoding: 'utf8' })
        let acc = ''
        let pos = 0
        let index
        rs
            .on('data', (chunk: string) => {
                index = chunk.indexOf(lineEnding)
                acc += chunk
                if (index === -1) {
                    pos += chunk.length
                } else {
                    index = chunk.indexOf(lineEnding, index + 1)
                    if (index >= 0) {
                        pos += index
                        rs.close()
                    } else {
                        pos += chunk.length
                    }
                }
            })
            .on('close', () => resolve(acc.slice(acc.charCodeAt(0) === 0xFEFF ? 1 : 0, pos)))
            .on('error', (err) => reject(err))
    })
}

// keypress(process.stdin)
// keypress.enableMouse(process.stdout)

function toUnicode(theString: string) {
    let unicodeString = ''
    for (let i = 0; i < theString.length; i++) {
        let theUnicode = theString.charCodeAt(i).toString(16).toUpperCase()
        while (theUnicode.length < 4) {
            theUnicode = '0' + theUnicode
        }
        theUnicode = '\\u' + theUnicode
        unicodeString += theUnicode
    }
    return unicodeString
}

commander
.version(pkg.version)
.option('--no-ui', 'just output text instead of renndering the puzzles (for accessibility)')
.option('-g, --game <title>', 'play a specific game matching this title regexp or "random" to pick a random one')
.option('-s, --size <largeOrSmall>', 'Specify the sprite size (either "large" or "small")')
.option('-n, --new', 'start a new game')
.option('-l, --level <num>', 'play a specific level', ((arg) => parseInt(arg, 10)))
.option('-r, --resume', 'resume the level from last save')
.on('--help', () => {
    console.log('')
    console.log('Note: saved game state is stored in ~/.local/puzzlescript/solutions/')
    console.log('')
})
.parse(process.argv)

run().then(() => { process.exit(0) }, (err) => {
    console.error(err)
    process.exit(111)
})

async function run() {
    inquirer.registerPrompt('autocomplete', PromptModule)
    const gists = await pify(glob)(path.join(__dirname, '../../games/*/script.txt'))
    const cliOptions: ICliOptions = commander.opts() as ICliOptions
    const { ui: cliUi, game: cliGameTitle } = cliOptions
    let { level: cliLevel, resume: cliResume } = cliOptions
    const gamePathInitial = commander.args[0]

    if (gamePathInitial) {
        await startPromptsAndPlayGame(gamePathInitial, null, cliResume, cliLevel)
        return // we are only playing one game
    }

    const games: IGameInfo[] = []

    const titleRegexp = /title/i
    for (const filePath of gists) {
        const lines = await first2Lines(filePath)
        const linesAry = lines.split('\n')
        let title
        if (titleRegexp.test(linesAry[0])) {
            title = linesAry[0].replace(/title /i, '')
        } else if (titleRegexp.test(linesAry[1])) {
            title = linesAry[1].replace(/title /i, '')
        } else {
            throw new Error(`BUG: Game does not have a title section in the 1st 2 lines`)
        }

        games.push({
            id: path.basename(path.dirname(filePath)),
            title,
            filePath
        })
    }

    if (!cliGameTitle) {
        const possibleFonts = TITLE_FONTS.filter(({ minWidth }) => minWidth <= (process.stdout.columns || 80))
        const font = possibleFonts[Math.floor(Math.random() * possibleFonts.length)] // pick a random one
        console.log(``)
        console.log(`Let's play some`)
        console.log(``)
        if (font) {
            fontAscii('Puzzle Games', { typeface: font.name })
        } else {
            console.log('Puzzle Games')
        }
        console.log(``)
        console.log(`(${chalk.bold.whiteBright(`${games.length}`)} games to choose from)`)
        console.log(``)
        console.log(``)
        console.log(`${chalk.dim('Games that are')} ${chalk.bold.whiteBright('white')} ${chalk.dim('are great to start out,')} ${chalk.bold.white('gray')} ${chalk.dim('are fun and run, and')} ${chalk.bold.dim('dark')} ${chalk.dim('may or may not run.')}`) // tslint:disable-line:max-line-length
        console.log(``)
    }

    // loop indefinitely
    let wantsToPlayAgain = false
    do {
        const { filePath: gamePath, id: gistId } = await promptGame(games, cliGameTitle)
        await startPromptsAndPlayGame(gamePath, gistId, cliResume, cliLevel)

        if (!cliGameTitle) {
            wantsToPlayAgain = await promptPlayAnother()
        }

        // clear the level and resume Options since if they play another game the options may not apply
        cliResume = undefined
        cliLevel = undefined

    } while (wantsToPlayAgain)

    if (cliUi) {
        console.log(``)
        console.log(``)
        console.log(`Thanks for playing PuzzleScript Games! Check out these links for more:`)
        console.log(``)
        console.log(`- ${chalk.blueBright('https://puzzlescript.net')} : The PuzzleScript homepage`)
        console.log(`- ${chalk.blueBright(pkg.homepage)} : Code for this program (${chalk.green('Help improve our code!')})`)
        console.log(``)
    }
}

async function startPromptsAndPlayGame(gamePath: string, gistId: Optional<string>, cliResume: boolean | undefined, cliLevel: number | undefined) {
    const cliOptions: ICliOptions = commander.opts() as ICliOptions
    const { ui: cliUi, size: cliSpriteSize, new: cliNewGame } = cliOptions

    const absPath = path.resolve(gamePath)
    const code = readFileSync(absPath, 'utf-8')
    const { data } = Parser.parse(code)

    console.log('')
    console.log(`Opened Game: "${chalk.blueBright(data.title)}"`)
    if (data.metadata.author) {
        console.log(`Author     : ${chalk.bold.whiteBright(data.metadata.author)}`)
    }
    if (data.metadata.homepage) {
        console.log(`Homepage   : ${chalk.bold.underline.blueBright(data.metadata.homepage)}`)
    }
    console.log('')

    showControls()
    // check to see if the terminal is too small
    await promptPixelSize(data, cliUi ? cliSpriteSize || null : CLI_SPRITE_SIZE.SMALL)

    // Load the solutions file (if it exists) so we can append to it
    const solutionPath = path.join(SOLUTION_ROOT, `${gistId}.json`)
    let recordings: { version: number, solutions: ILevelRecording[], title: string, totalLevels: number, totalMapLevels: number }
    if (gistId && existsSync(solutionPath)) {
        recordings = JSON.parse(readFileSync(solutionPath, 'utf-8'))
    } else {
        recordings = { version: 1, solutions: [], title: data.title, totalLevels: data.levels.length, totalMapLevels: data.levels.filter((l) => l.type === LEVEL_TYPE.MAP).length } // default
    }

    const currentLevelNum = await promptChooseLevel(recordings, data, cliNewGame ? 0 : cliLevel || null)

    // Allow the user to resume from where they left off
    let ticksToRunFirst = ''
    if (recordings.solutions[currentLevelNum] && (recordings.solutions[currentLevelNum].partial || recordings.solutions[currentLevelNum].solution)) {
        let shouldResume
        if (cliResume !== undefined) {
            shouldResume = cliResume
        } else {
            shouldResume = (await inquirer.prompt<{ shouldResume: boolean }>({
                type: 'confirm',
                name: 'shouldResume',
                message: 'Would you like to resume where you left off?'
            })).shouldResume
        }
        if (shouldResume) {
            ticksToRunFirst = recordings.solutions[currentLevelNum].partial || recordings.solutions[currentLevelNum].solution || ''
        }
    }

    // Prepare the keyboard handler
    if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true)
    } else {
        throw new Error(`ERROR: stdin does not allow setting setRawMode (we need that for keyboard input`)
    }
    process.stdin.resume()
    process.stdin.setEncoding('utf8')

    TerminalUI.clearScreen()

    await playGame(data, currentLevelNum, recordings, ticksToRunFirst, absPath, solutionPath, cliUi, cliLevel !== undefined /*only run one level if specified*/)
}

async function playGame(data: GameData, currentLevelNum: number, recordings: ISaveFile, ticksToRunFirst: string,
                        absPath: string, solutionPath: string, cliUi: boolean, onlyOneLevel: boolean) {

    let keypresses: string[] = [] // set later once we walk through all the existing partial keys
    let pendingKey = null
    let tickNum = 0
    let shouldExitGame: boolean = false
    let dontSaveInitialLoad = true

    logger.debug(() => `Start playing "${data.title}". Level ${currentLevelNum}`)

    const ticksToRunFirstAry = ticksToRunFirst.split('')

    TerminalUI.setHasVisualUi(cliUi)

    const level = data.levels[currentLevelNum]
    if (!level) {
        throw new Error(`BUG: Could not find level ${currentLevelNum}`)
    }
    const engine = new GameEngine(data, new EmptyGameEngineHandler([TerminalUI, {
        onLevelChange(newLevel: number) {
            if (dontSaveInitialLoad) {
                dontSaveInitialLoad = false
                keypresses = []
                return
            }
            if (!supportsColor.stdout) {
                console.log('You beat the level!')
            }

            // Save the solution
            recordings.solutions[newLevel - 1] = { solution: keypresses.join('') }
            ensureDirSync(path.dirname(solutionPath))
            writeFileSync(solutionPath, JSON.stringify(recordings, null, 2))
            keypresses = []
            pendingKey = null
            currentLevelNum = newLevel
        },
        async onMessage() {
            keypresses.push('!')
        }
    }]))
    engine.on('loading-cells', ({ cellStart, cellEnd, cellTotal }: ILoadingCellsEvent) => {
        // UI.writeDebug(`Loading cells ${cellStart}-${cellEnd} of ${cellTotal}. SpriteKey="${key}"`)
        const loading = `Loading... [`
        const barChars = '                    '
        TerminalUI.writeDebug(loading + barChars, 1)
        const offset = loading.length + 1
        const barLength = barChars.length
        const percentStartYellow = Math.floor(barLength * cellStart / cellTotal)
        const percentStartBlack = Math.floor(barLength * (cellStart + cellEnd) / cellTotal)
        for (let i = 0; i < barLength; i++) {
            let fgColor = '#707070'
            const char = '█'
            if (i <= percentStartYellow) {
                fgColor = '#00ff00' // green
            } else if (i <= percentStartBlack) {
                fgColor = '#ffff00' // yellow
                // char = '▒' // ░▒▓
            }
            TerminalUI._drawPixel(i + offset, 0, fgColor, null, char)
        }
    })
    TerminalUI.clearScreen()
    // TODO: Support saving and loading checkpoints in the CLI
    engine.setLevel(data.levels.indexOf(level), null/*no checkpoint*/)

    function restartLevel() {
        engine.press(INPUT_BUTTON.RESTART)
        TerminalUI.renderScreen(true)
        keypresses = [] // clear key history
    }

    // https://stackoverflow.com/a/30687420
    process.stdin.on('data', handleKeyPress)
    async function handleKeyPress(key: string) {
        if (process.env.NODE_ENV === 'developer' && !TerminalUI.getHasVisualUi()) {
            console.log(`${chalk.dim(`Pressed:`)} ${chalk.whiteBright(key)}`)
        }
        switch (key) {
            case 'W':
            case 'w':
            case '\u001B\u005B\u0041': // UP-ARROW
                pendingKey = 'W'; break
            case 'S':
            case 's':
            case '\u001B\u005B\u0042': // DOWN-ARROW
                pendingKey = 'S'; break
            case 'A':
            case 'a':
            case '\u001B\u005B\u0044': // LEFT-ARROW
                pendingKey = 'A'; break
            case 'D':
            case 'd':
            case '\u001B\u005B\u0043': // RIGHT-ARROW
                pendingKey = 'D'; break
            case 'X':
            case 'x':
            case ' ':
            case '\u000D':
                pendingKey = 'X'; break
            case 'R':
            case 'r':
                return restartLevel()
            case 'U':
            case 'Z':
            case 'u':
            case 'z':
                // update keypresses so that it does not contain the most-recent key
                while (keypresses.length > 0) {
                    const lastKey = keypresses[keypresses.length - 1]
                    keypresses.pop()
                    if (!(lastKey === '.' || lastKey === ',')) {
                        break
                    }
                }
                engine.press(INPUT_BUTTON.UNDO)
                TerminalUI.renderScreen(false)
                return
            case 'C':
            case 'c':
                TerminalUI.clearScreen()
                TerminalUI.renderScreen(false)
                return
            case 'I':
            case 'i':
                TerminalUI.moveInspector(RULE_DIRECTION.UP)
                return
            case 'J':
            case 'j':
                TerminalUI.moveInspector(RULE_DIRECTION.LEFT)
                return
            case 'K':
            case 'k':
                TerminalUI.moveInspector(RULE_DIRECTION.DOWN)
                return
            case 'L':
            case 'l':
                TerminalUI.moveInspector(RULE_DIRECTION.RIGHT)
                return
            case 'P':
            case 'p':
                const players = data.getPlayer().getCellsThatMatch(_flatten(TerminalUI.getCurrentLevelCells()))
                if (players.size === 1) {
                    TerminalUI.moveInspectorTo([...players][0])
                } else {
                    console.log(`There are ${players.size} players. Use tab to select which one`)
                }
                return
            case '\u0003': // Ctrl+C
                closeSounds()
                return process.exit(1)
            case '\u001B': // Escape
                saveCoverageFile(data, absPath, `${path.basename(path.dirname(absPath))}-playgame`)
                // Save the partially-completed steps
                if (keypresses.join('').replace(/\./g, '').length > 0) { // skip just empty ticks
                    recordings.solutions[currentLevelNum] = recordings.solutions[currentLevelNum] || {}
                    recordings.solutions[currentLevelNum].partial = keypresses.join('')
                    await ensureDir(path.dirname(solutionPath))
                    writeFileSync(solutionPath, JSON.stringify(recordings, null, 2))
                }
                closeSounds()
                shouldExitGame = true
                return
            case '1':
                if (process.env.NODE_ENV === 'development') {
                    pendingKey = '[pause]'
                }
                return
            case '2':
                if (process.env.NODE_ENV === 'development') {
                    pendingKey = '[continue]'
                }
                return
            case '9':
                // Save State
                if (process.env.NODE_ENV === 'development') {
                    const cellState = engine.saveSnapshotToJSON()
                    recordings.solutions[currentLevelNum].snapshot = { tickNum, cellState }
                    await ensureDir(path.dirname(solutionPath))
                    writeFileSync(solutionPath, JSON.stringify(recordings, null, 2))
                }
                return
            case '0':
                // Load most-recent state
                if (process.env.NODE_ENV === 'development') {
                    const { snapshot } = recordings.solutions[currentLevelNum]
                    if (snapshot) {
                        const { tickNum: savedTickNum, cellState } = snapshot
                        engine.loadSnapshotFromJSON(cellState)
                        tickNum = savedTickNum
                    }
                }
                return
            default:
                TerminalUI.writeDebug(`pressed....: "${toUnicode(key)}"`, 1)
        }
    }

    let isPaused = false

    function doPress(key: string) {
        switch (key) {
            case 'W': engine.press(INPUT_BUTTON.UP); break
            case 'S': engine.press(INPUT_BUTTON.DOWN); break
            case 'A': engine.press(INPUT_BUTTON.LEFT); break
            case 'D': engine.press(INPUT_BUTTON.RIGHT); break
            case 'X': engine.press(INPUT_BUTTON.ACTION); break
            case 'b': // so we can set a breakpoint in the playback
            case '[pause]': isPaused = true; break
            case '[continue]': isPaused = false; break
            case '!': // dismiss a message
            case '.':
            case ',':
                // just .tick()
                break
            default:
                throw new Error(`BUG: Invalid keypress character "${ticksToRunFirstAry[tickNum]}"`)
        }
        keypresses.push(key)
    }

    TerminalUI.onGameChange(engine.getGameData())
    TerminalUI.clearScreen()
    TerminalUI.renderScreen(false)
    TerminalUI.writeDebug(`"${data.title}"`, 1)

    // Run a bunch of ticks in case the user partially played a level
    let maxTickAndRenderTime = -1
    for (tickNum = 0; tickNum < ticksToRunFirstAry.length; tickNum++) {
        let key = ticksToRunFirstAry[tickNum]
        const startTime = Date.now()

        if (isPaused && !pendingKey) {
            tickNum--
            await sleep(1000)
            continue
        }
        if (pendingKey) {
            key = pendingKey
            ticksToRunFirstAry.splice(tickNum, 0, key)
            pendingKey = null
            if (key === '[continue]') {
                console.log('New Game Code:')
                console.log(ticksToRunFirstAry.join(''))
            }
        }
        doPress(key)
        const { didLevelChange } = await engine.tick()

        if (didLevelChange) {
            if (onlyOneLevel) {
                return
            }
        }

        if (tickNum > 1) { // Skip the 1st couple because they might be cleaning up the level
            maxTickAndRenderTime = Math.max(maxTickAndRenderTime, Date.now() - startTime)
        }

        const tickHistory = ticksToRunFirstAry.slice(Math.max(tickNum - 25, 0), tickNum + 1).join('')
        const msg = `Playback ${tickNum}/${ticksToRunFirstAry.length} of "${data.title}" (took ${Date.now() - startTime}ms) ${tickHistory}`
        TerminalUI.writeDebug(msg.substring(0, 160), 1)

        await sleep(1) // sleep long enough to play sounds
        // await sleep(Math.max(100 - (Date.now() - startTime), 0))
    }

    while (true) {
        let maxSleepTime = process.env.NODE_ENV === 'development' ? 500 : 50
        // Exit the game if the user pressed escape
        if (shouldExitGame) {
            break // so we can detach key listeners
        }

        if (isPaused && !pendingKey) {
            await sleep(maxSleepTime)
            continue
        }

        let didHandleKeyPress = false
        if (pendingKey && !engine.hasAgain()) {
            doPress(pendingKey)
            pendingKey = null
            didHandleKeyPress = true
        }
        const startTime = Date.now()
        const { changedCells, didLevelChange, wasAgainTick } = await engine.tick()

        if (didLevelChange) {
            TerminalUI.clearScreen()
            TerminalUI.renderScreen(true)
        }

        const msg = `Tick: ${tickNum} took ${Date.now() - startTime}ms. Moves: ${[...keypresses].reverse().join('').substring(0, 20)}`
        TerminalUI.writeDebug(msg.substring(0, 160), 1)

        if (wasAgainTick) {
            keypresses.push(',')
        } else {
            if (!didHandleKeyPress && changedCells.size > 0) {
                keypresses.push('.') // Add a "tick"
                if (process.env.NODE_ENV === 'development') {
                    maxSleepTime = 500 // Slow down when every "." matters (for recording)
                }
            }
            pendingKey = null
        }

        await sleep(Math.max(maxSleepTime - (Date.now() - startTime), 0))

        tickNum++
    }

    // Some versions of node do not offer this method (e.g. maybe v8.11.1)
    if (process.stdin.off) {
        process.stdin.off('data', handleKeyPress)
    }
}

async function promptPlayAnother() {
    const { playAnotherGame } = await inquirer.prompt<{
        playAnotherGame: boolean;
    }>({
        type: 'confirm',
        name: 'playAnotherGame',
        message: 'Would you like to play another game?'
    })
    return playAnotherGame
}

enum START_MODE {
    NEW_GAME = 'New Game',
    CONTINUE = 'Continue',
    CHOOSE_LEVEL = 'Choose a Level'
}

async function promptChooseLevel(recordings: ISaveFile, data: GameData, cliLevel: Optional<number>) {
    const levels = data.levels
    const firstUncompletedLevel = levels
        .indexOf(levels
            .filter((l, index) => !(recordings.solutions[index] && recordings.solutions[index].solution))[0]
        )

    if (cliLevel) {
        return cliLevel
    }
    // First ask if they want to Continue, Start a new Game, or Choose a Level
    const startModeOptions: any[] = []
    if (firstUncompletedLevel > 0) {
        startModeOptions.push(START_MODE.CONTINUE)
    }
    startModeOptions.push(START_MODE.NEW_GAME)
    startModeOptions.push(new inquirer.Separator())
    startModeOptions.push(START_MODE.CHOOSE_LEVEL)

    const { startMode } = await inquirer.prompt<{
        startMode: START_MODE;
    }>([{
        type: 'list',
        name: 'startMode',
        message: 'What would you like to do?',
        choices: startModeOptions
    }])

    if (startMode === START_MODE.NEW_GAME) {
        return 0
    } else if (startMode === START_MODE.CONTINUE) {
        return firstUncompletedLevel
    } else if (startMode !== START_MODE.CHOOSE_LEVEL) {
        throw new Error(`BUG: Invalid startMode: ${startMode}`)
    }

    const { currentLevelNum } = await inquirer.prompt<{
        currentLevelNum: number;
    }>([{
        type: 'list',
        name: 'currentLevelNum',
        message: 'Which Level would you like to play?',
        default: firstUncompletedLevel,
        pageSize: Math.max(15, getTerminalSize().rows - 15),
        choices: levels.map((levelMap, index) => {
            const hasSolution = recordings.solutions[index] && recordings.solutions[index].solution
            if (levelMap.type === LEVEL_TYPE.MAP) {
                const levelRows = levelMap.cells
                const cols = levelRows[0]
                let width = cols.length
                let height = levelRows.length
                // If flickscreen or zoomscreen is enabled, then change the level size
                // that is reported
                const { zoomscreen, flickscreen } = data.metadata
                if (flickscreen) {
                    height = flickscreen.height
                    width = flickscreen.width
                }
                if (zoomscreen) {
                    height = zoomscreen.height
                    width = zoomscreen.width
                }
                const { columns, rows } = getTerminalSize()
                const isTooWide = columns < width * 5 * TerminalUI.PIXEL_WIDTH
                const isTooTall = rows < height * 5 * TerminalUI.PIXEL_HEIGHT
                let message = ''
                if (isTooWide && isTooTall) {
                    message = `(too tall & wide for your terminal)`
                } else if (isTooWide) {
                    message = `(too wide for your terminal)`
                } else if (isTooTall) {
                    message = `(too tall for your terminal)`
                }
                if (hasSolution) {
                    return {
                        name: `${chalk.green(`${index}`)} ${chalk.dim(`(${width} x ${height}) ${chalk.green('(SOLVED)')}`)} ${chalk.yellowBright(message)}`,
                        value: index
                    }
                } else {
                    if (message) {
                        return {
                            name: `${chalk.whiteBright(`${index}`)} ${chalk.red(`(${width} x ${height})`)} ${chalk.yellowBright(message)}`,
                            value: index
                        }
                    } else {
                        return {
                            name: `${chalk.whiteBright(`${index}`)} ${chalk.green(`(${width} x ${height})`)}`,
                            value: index
                        }
                    }
                }
            } else {
                const message = levelMap.message
                let snippet = message.split('\n')[0] // just use the 1st line
                if (snippet.length > 40) {
                    snippet = `${snippet.substring(0, 40)}...`
                }
                return {
                    name: chalk.dim(`... "${snippet}"`),
                    value: index
                }
            }
        })
    }])

    return currentLevelNum
}

async function promptPixelSize(data: GameData, cliSpriteSize: Optional<CLI_SPRITE_SIZE>) {
    if (cliSpriteSize === CLI_SPRITE_SIZE.SMALL) {
        TerminalUI.setSmallTerminal(true)
    } else if (cliSpriteSize === CLI_SPRITE_SIZE.LARGE) {
        // do nothing since the terminal size is large by default
    } else if (!TerminalUI.willAllLevelsFitOnScreen(data)) {
        // Draw some example sprites
        console.log('Some of the levels in this game are too large for your terminal.')
        console.log('You can resize your terminal or use compact sprites.')
        console.log('There may be some graphical artifacts if you use compact sprites.')
        console.log('Below are examples of a compact sprite and a non-compacted sprite:')
        console.log('')
        const b = chalk.bgBlueBright(' ')
        const y = chalk.bgYellowBright(' ')
        const k = chalk.bgBlack(' ')
        const by = chalk.bgBlueBright.yellowBright('▄')
        const yb = chalk.bgYellowBright.blueBright('▄')
        const yk = chalk.black.bgYellowBright('▄')
        const ky = chalk.bgBlack.yellowBright('▄')
        const bk = chalk.bgBlueBright.black('▄')
        console.log(b + b + b + b + b + b + b + b + b + b + b + b + b + b)
        console.log(b + b + b + b + y + y + y + y + y + y + b + b + b + b)
        console.log(b + b + y + y + k + k + y + y + k + k + y + y + b + b)
        console.log(b + b + k + k + y + y + y + y + y + y + k + k + b + b)
        console.log(b + b + y + y + k + k + k + k + k + k + y + y + b + b)
        console.log(b + b + b + b + y + y + y + y + y + y + b + b + b + b)
        console.log(b + b + b + b + b + b + b + b + b + b + b + b + b + b)
        console.log('')
        console.log('')
        console.log(b + b + by + by + by + b + b)
        console.log(b + yk + ky + y + ky + yk + b)
        console.log(b + yb + ky + ky + ky + yb + b)
        console.log(bk + bk + bk + bk + bk + bk + bk)
        const { useCompressedCharacters } = await inquirer.prompt<{
            useCompressedCharacters: boolean;
        }>({
            type: 'confirm',
            name: 'useCompressedCharacters',
            default: process.env.NODE_ENV !== 'development',
            message: 'Would you like to use small characters when rendering the game?'
        })
        if (useCompressedCharacters) {
            TerminalUI.setSmallTerminal(true)
        }
    }
}

// https://stackoverflow.com/a/12646864
function shuffleArray<T>(array: T[]) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]] // eslint-disable-line no-param-reassign
    }
    return array
}

function percentComplete(game: IGameInfo) {
    const solutionsPath = path.join(SOLUTION_ROOT, `${game.id}.json`)
    let message = process.env.NODE_ENV === 'development' ? chalk.bold.red('(unstarted)') : ''
    if (existsSync(solutionsPath)) {
        const recordings: { version: number, solutions: ILevelRecording[], title: string, totalLevels: number, totalMapLevels: number } = JSON.parse(readFileSync(solutionsPath, 'utf-8'))
        const numerator = recordings.solutions.filter((s) => s && s.solution && s.solution.length > 1).length
        const denominator = recordings.totalMapLevels
        const percent = 100 * numerator / denominator
        let colorFn = chalk.bold.green
        if (numerator === denominator) {
            colorFn = chalk.blueBright
        } else if (percent > 75) {
            colorFn = chalk.redBright
        } else if (percent > 25) {
            colorFn = chalk.yellowBright
        } else if (percent > 0) {
            colorFn = chalk.greenBright
        }

        message = chalk.gray(`(${colorFn(`${numerator}/${denominator}`)})`)
    }
    return message
}

async function promptGame(games: IGameInfo[], cliGameTitle: string | undefined) {
    // Sort games by games that are fun and should be played first
    const firstGames = [
        'Pot Wash Panic',
        'PUSH',
        'Beam Islands',
        'Pants, Shirt, Cap',
        'Entanglement - Chapter One',
        'Mirror Isles',
        'IceCrates',
        'Boxes & Balloons',
        'Boxes Love Bloxing Gloves',
        'Cyber-Lasso',
        'Pushcat Jr',
        'Skipping Stones to Lonely Homes',
        'Hack the Net',
        'Garten der Medusen',
        'SwapBot',
        'Separation',
        'Roll those Sixes',
        'Spacekoban',
        "Spikes 'n' Stuff",
        'Rock, Paper, Scissors (v0.90 = v1.alpha)',
        'Spooky Pumpkin Game',
        'Vacuum',
        'Miss Direction',
        'Alien Disco',
        'Some lines were meant to be crossed',
        'Flying Kick⁣',
        'Memories Of Castlemouse',
        'Bubble Butler: CMD REORGANIZE',
        'Sokoboros',
        'Sleepy players',
        // rosden games
        'Islands',
        'bomb n ice',
        'compressed',
        'consumed to 1',
        'duality',
        'dup-block',
        'fire in winter',
        'fuse to green',
        'inbetween',
        'infected',
        'interconnection',
        'Path lines',
        'pull and push',
        'purple',
        'rows and columns',
        'shifting',
        'sticky',
        'Teleporters',
        'The art of storage',
        'the big dig',
        'the copying',
        'the walls you leave behind',
        'tile step',
        'using pushers',
        // End rosden games
        'Airport Aggression',
        'Coin Counter',
        'Dangerous Dungeon',
        'Easy Enigma',
        "Spider's Hollow",
        'MazezaM',
        'pretender to the crown',
        'Vines',
        'Unconventional Guns⁣',
        'Dungeon Janitor',
        'It Dies In The Light',
        'Collapse',
        'JAM3 Game',
        'Collapsable Sokoban',
        'Element Walkers',
        'Telefrag',
        'Count Mover',
        'ESL Puzzle Game -- CHALLENGE MODE アダムのパズルゲーム'
    ]

    function getGameIndexForSort(gameInfo: IGameInfo) {
        let gameIndex = firstGames.indexOf(gameInfo.title)
        if (gameIndex < 0) {
            gameIndex = firstGames.length
        }
        return gameIndex
    }
    games = games.sort((a, b) => {
        return getGameIndexForSort(a) - getGameIndexForSort(b)
    })

    const question: inquirer.Question = {
        type: 'autocomplete',
        name: 'selectedGameId',
        message: 'Which game would you like to play?',
        pageSize: Math.max(15, getTerminalSize().rows - 15),
        source: async(answers: void, input: string) => {
            let filteredGames
            if (!input) {
                filteredGames = games
            } else {
                filteredGames = games.filter(({ id, title, filePath }) => {
                    return title.toLowerCase().indexOf(input.toLowerCase()) >= 0
                })
            }
            return Promise.resolve(filteredGames.map((game) => {
                // dim the games that are not recommended
                const index = firstGames.indexOf(game.title)
                if (index <= 10) {
                    return {
                        name: chalk.bold.whiteBright(`${game.title} ${percentComplete(game)}`),
                        value: game.id
                    }
                } else if (SOLVED_GAMES.has(game.title)) {
                    return {
                        name: chalk.white(`${game.title} ${percentComplete(game)}`),
                        value: game.id
                    }
                } else {
                    return {
                        name: chalk.dim(`${game.title} ${percentComplete(game)}`),
                        value: game.id
                    }
                }
            }))
        }

    // coercing because we use the autcomplete plugin and it defines a `source:` object
    } as inquirer.Question // tslint:disable-line:no-object-literal-type-assertion

    let chosenGame
    if (cliGameTitle) {
        if (cliGameTitle.toUpperCase() === 'RANDOM') {
            chosenGame = shuffleArray([...games])[0]
        } else {
            // try to match the title exactly, then try a substring
            chosenGame = games.find((g) => {
                return g.title.toLowerCase() === cliGameTitle.toLowerCase()
            })

            if (!chosenGame) {
                chosenGame = games.find((g) => {
                    return g.title.toLowerCase().indexOf(cliGameTitle.toLowerCase()) >= 0
                })
            }
        }
        if (!chosenGame) {
            console.error(`ERROR: Could not find game with title "${cliGameTitle}"`)
            process.exit(111)
            throw new Error('Could not find game')
        }
    } else {
        const { selectedGameId } = (await inquirer.prompt<{ selectedGameId: string }>([question]))
        chosenGame = games.filter((game) => game.id === selectedGameId)[0]
        if (!chosenGame) {
            throw new Error(`BUG: Could not find game "${selectedGameId}"`)
        }
    }

    return chosenGame
}

function showControls() {
    function prettyKey(keyCode: string) {
        return chalk.whiteBright.bgWhite(`[${chalk.black(keyCode)}]`)
    }
    console.log(`-------------------------------------`)
    console.log(`Controls:`)
    console.log(`  ${prettyKey('W')} or ${prettyKey('up')}    : Move Up`)
    console.log(`  ${prettyKey('S')} or ${prettyKey('down')}  : Move Down`)
    console.log(`  ${prettyKey('A')} or ${prettyKey('left')}  : Move Left`)
    console.log(`  ${prettyKey('D')} or ${prettyKey('right')} : Move Right`)
    console.log(`  ${prettyKey('X')} or ${prettyKey('space')} : Perform Action`)
    console.log(`  ${prettyKey('Z')} or ${prettyKey('U')}     : Undo`)
    console.log(`  ${prettyKey('R')}            : Restart the current level`)
    console.log(`  ${prettyKey('C')}            : Clear and redraw the screen`)
    console.log(`  ${prettyKey('esc')}          : Exit the Game`)
    console.log(`-------------------------------------`)
    console.log(`Accessibility Controls: (for inspecting which sprites are in the puzzle)`)
    console.log(`  ${prettyKey('I')}            : Move Inspector Up`)
    console.log(`  ${prettyKey('K')}            : Move Inspector Down`)
    console.log(`  ${prettyKey('J')}            : Move Inspector Left`)
    console.log(`  ${prettyKey('L')}            : Move Inspector Right`)
    console.log(`  ${prettyKey('P')}            : Move Inspector onto the Player`)
    console.log(`-------------------------------------`)
}
