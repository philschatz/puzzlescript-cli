import { INPUT_BUTTON, Optional } from '../util'
import { BUTTON_TYPE, Controllers, IButton, IGamepad, IKeyboardButton, IStick, STICK_TYPE } from './controller/controller'

interface Control<T> {
    up: T,
    down: T,
    left: T,
    right: T,
    action: T,
    undo: T,
    restart: T
}

interface StickControl<T> {
    left: T,
    right: T,
}

const DURATION_TO_UNDO = 500
const DURATION_TO_ACTION = 200
const DURATION_TO_RESTART = 2000
const LENGTH_TO_SWIPE = 15

export default class InputWatcher {
    public readonly gamepad: IGamepad
    private readonly table: HTMLTableElement
    private readonly controls: Control<{button: IButton, lastPressed: Optional<number>}>
    private readonly stickControls: StickControl<{stick: IStick, lastPressed: Optional<number>}>
    private readonly controlCheckers: (() => void)[]
    private readonly boundKeys: IKeyboardButton[]
    private polledInput: Optional<INPUT_BUTTON>
    private repeatIntervalInSeconds: Optional<number>
    private touchStart: Optional<Touch> // For handling touch gestures
    private touchStartedAt: number
    private touchHoldInterval: Optional<NodeJS.Timeout>

    constructor(table: HTMLTableElement) {
        this.gamepad = Controllers.getAnyGamepad()
        this.table = table
        this.polledInput = null
        this.repeatIntervalInSeconds = null
        this.boundKeys = []
        this.touchStart = null
        this.touchStartedAt = 0
        this.touchHoldInterval = null

        const keyboardKey = (key: string) => {
            const button = Controllers.key(key, table)
            this.boundKeys.push(button)
            return button
        }

        // const anyGamepad = Contro.getAnyGamepad()
        // const stick = Contro.orSticks([
        //     dpadAsStick(anyGamepad),
        //     anyGamepad.stick(STICK_TYPE.LEFT),
        //     anyGamepad.stick(STICK_TYPE.RIGHT),
        //     // arrowKeysAsStick(),
        //     // wsadKeysAsStick(),
        //     Contro.asStick(keyboardKey('w'), keyboardKey('s'), keyboardKey('a'), keyboardKey('d')),
        //     Contro.asStick(keyboardKey('ArrowUp'), keyboardKey('ArrowDown'), keyboardKey('ArrowLeft'), keyboardKey('ArrowRight')),
        // ])
        // const action = Contro.or([this.gamepad.button(BUTTON_TYPE.CLUSTER_BOTTOM), keyboardKey('x'), keyboardKey(' '), keyboardKey('Enter')])
        // const undo = Contro.or([this.gamepad.button(BUTTON_TYPE.CLUSTER_LEFT), this.gamepad.button(BUTTON_TYPE.BUMPER_TOP_LEFT), keyboardKey('z'), keyboardKey('u')])
        // const restart = Contro.or([this.gamepad.button(BUTTON_TYPE.CLUSTER_TOP), keyboardKey('r')])

        this.controls = {
            up: { lastPressed: null, button: Controllers.or([this.gamepad.button(BUTTON_TYPE.ARROW_UP), keyboardKey('w'), keyboardKey('ArrowUp')]) },
            down: { lastPressed: null, button: Controllers.or([this.gamepad.button(BUTTON_TYPE.ARROW_DOWN), keyboardKey('s'), keyboardKey('ArrowDown')]) },
            left: { lastPressed: null, button: Controllers.or([this.gamepad.button(BUTTON_TYPE.ARROW_LEFT), keyboardKey('a'), keyboardKey('ArrowLeft')]) },
            right: { lastPressed: null, button: Controllers.or([this.gamepad.button(BUTTON_TYPE.ARROW_RIGHT), keyboardKey('d'), keyboardKey('ArrowRight')]) },
            action: { lastPressed: null, button: Controllers.or([this.gamepad.button(BUTTON_TYPE.CLUSTER_BOTTOM), keyboardKey('x'), keyboardKey(' '), keyboardKey('Enter')]) },
            undo: { lastPressed: null, button: Controllers.or([this.gamepad.button(BUTTON_TYPE.CLUSTER_LEFT), this.gamepad.button(BUTTON_TYPE.BUMPER_TOP_LEFT), keyboardKey('z'), keyboardKey('u')]) },
            restart: { lastPressed: null, button: Controllers.or([this.gamepad.button(BUTTON_TYPE.CLUSTER_TOP), keyboardKey('r')]) }
        }
        this.stickControls = {
            left: { lastPressed: null, stick: this.gamepad.stick(STICK_TYPE.LEFT) },
            right: { lastPressed: null, stick: this.gamepad.stick(STICK_TYPE.RIGHT) }
        }

        const makeChecker = (control: keyof Control<IButton>, gameAction: () => void) => {
            return () => {
                const now = Date.now()
                const interval = (this.repeatIntervalInSeconds || .25) * 1000
                const { button, lastPressed } = this.controls[control]
                if (button.query()) {
                    if (!lastPressed || (lastPressed + interval) < now) {
                        gameAction()
                        this.controls[control].lastPressed = now
                    }
                } else {
                    this.controls[control].lastPressed = null
                }
            }
        }

        const makeStickChecker = (whichStick: keyof StickControl<any>) => {
            return () => {
                const now = Date.now()
                const interval = (this.repeatIntervalInSeconds || .25) * 1000
                const control = this.stickControls[whichStick]
                const { stick, lastPressed } = control
                const { x: xAxis, y: yAxis } = stick.query()
                const yLean = Math.abs(yAxis)
                const xLean = Math.abs(xAxis)
                if (yLean > xLean) {
                    if (yLean > .5) {
                        if (!lastPressed || (lastPressed + interval) < now) {
                            control.lastPressed = now
                            this.polledInput = yAxis < 0 ? INPUT_BUTTON.UP : INPUT_BUTTON.DOWN
                        }
                        return
                    }
                } else {
                    if (xLean > .5) {
                        if (!lastPressed || (lastPressed + interval) < now) {
                            control.lastPressed = now
                            this.polledInput = xAxis < 0 ? INPUT_BUTTON.LEFT : INPUT_BUTTON.RIGHT
                        }
                        return
                    }
                }
                control.lastPressed = null
            }
        }

        this.controlCheckers = [
            makeStickChecker('left'),
            makeStickChecker('right'),
            makeChecker('up', () => this.polledInput = INPUT_BUTTON.UP),
            makeChecker('down', () => this.polledInput = INPUT_BUTTON.DOWN),
            makeChecker('left', () => this.polledInput = INPUT_BUTTON.LEFT),
            makeChecker('right', () => this.polledInput = INPUT_BUTTON.RIGHT),
            makeChecker('action', () => this.polledInput = INPUT_BUTTON.ACTION),
            makeChecker('undo', () => this.polledInput = INPUT_BUTTON.UNDO),
            makeChecker('restart', () => this.polledInput = INPUT_BUTTON.RESTART)
        ]

        this.onTouchStart = this.onTouchStart.bind(this)
        this.onTouchMove = this.onTouchMove.bind(this)
        this.onTouchEnd = this.onTouchEnd.bind(this)

        this.table.addEventListener('touchstart', this.onTouchStart, { passive: true })
        this.table.addEventListener('touchmove', this.onTouchMove)
        this.table.addEventListener('touchend', this.onTouchEnd)
    }

    public pollControls() {
        if (window.document.activeElement !== this.table) {
            // Ignore if the game is not in focus
            return null
        }
        this.controlCheckers.forEach((fn) => fn())
        const input = this.polledInput
        this.polledInput = null
        return input
    }

    public isSomethingPressed() {
        for (const entry of Object.values(this.controls)) {
            if (entry.button.query()) {
                return true
            }
        }
        return false
    }

    public setKeyRepeatInterval(repeatIntervalInSeconds: number) {
        this.repeatIntervalInSeconds = repeatIntervalInSeconds
    }

    public dispose() {
        for (const button of this.boundKeys) {
            button.dispose()
        }

        this.table.removeEventListener('touchstart', this.onTouchStart)
        this.table.removeEventListener('touchmove', this.onTouchMove)
        this.table.removeEventListener('touchend', this.onTouchEnd)
    }

    private startTouchHoldInterval() {
        if (!this.touchHoldInterval) {
            this.touchHoldInterval = setInterval(() => this.polledInput = INPUT_BUTTON.UNDO, DURATION_TO_UNDO)
        }
    }

    private endTouchHoldInterval() {
        this.touchHoldInterval && clearInterval(this.touchHoldInterval)
        this.touchHoldInterval = null
    }

    private onTouchStart(evt: TouchEvent) {
        if (evt.changedTouches.length === 1) {
            this.table.focus() // in case the game was paused and the user is trying to resume
            this.touchStart = evt.changedTouches[0]
            this.touchStartedAt = Date.now()

            this.startTouchHoldInterval()
        }
        // Still allow the user to zoom
    }

    private onTouchMove(evt: TouchEvent) {
        // Make sure the user is not zooming
        if (this.touchStart && evt.touches.length === 1) {
            evt.preventDefault()
        }
    }

    private onTouchEnd(evt: TouchEvent) {

        const handleTap = () => {
            const now = Date.now()
            const timeHolding = now - this.touchStartedAt
            if (timeHolding >= DURATION_TO_RESTART) {
                const shouldRestart = confirm('You were holding for a while. Do you want to restart the level?')
                this.polledInput = shouldRestart ? INPUT_BUTTON.RESTART : null
            } else if (timeHolding < DURATION_TO_ACTION) {
                this.polledInput = INPUT_BUTTON.ACTION
            }
        }

        this.endTouchHoldInterval()

        if (this.touchStart && evt.changedTouches.length === 1) {
            const touchEnd = evt.changedTouches[0]

            const xDist = touchEnd.pageX - this.touchStart.pageX
            const yDist = touchEnd.pageY - this.touchStart.pageY

            const xAbs = Math.abs(xDist)
            const yAbs = Math.abs(yDist)
            if (xAbs > yAbs) {
                // The main axis is "X"
                if (xAbs > this.table.clientWidth / LENGTH_TO_SWIPE) {
                    this.polledInput = xDist > 0 ? INPUT_BUTTON.RIGHT : INPUT_BUTTON.LEFT
                } else {
                    handleTap()
                }
            } else {
                // The main axis is "Y"
                if (yAbs > this.table.clientWidth / LENGTH_TO_SWIPE) { // assume mobile pixels are square so use the width
                    this.polledInput = yDist > 0 ? INPUT_BUTTON.DOWN : INPUT_BUTTON.UP
                } else {
                    handleTap()
                }
            }
            this.touchStart = null
            evt.preventDefault()
        }
    }
}
