import '@babel/polyfill' // tslint:disable-line:no-implicit-dependencies
import SyncTableEngine from './browser/SyncTableEngine'
import WebworkerTableEngine from './browser/WebworkerTableEngine'
import { closeSounds } from './sounds'

// Public API
(window as any).PuzzleScript = {
    WebworkerTableEngine,
    SyncTableEngine,
    closeSounds
}
