import { Optional } from '../util'
import { ALL_GAMES, GameInfo } from './allGames'
import { currentInfo, StorageGameInfo } from './playGame'
import { getElement } from './util'

const POPULAR_GAMES = [
    'push',
    'pot-wash-panic',
    'skipping-stones',
    'entanglement-one',
    'mirror-isles',
    'cyber-lasso',
    'swapbot',
    'bubble-butler',
    'flying-kick',
    'beam-islands',
    'pushcat-jr',
    'icecrates',
    'sokobond',
    'spooky-pumpkin-game',
    'spikes-n-stuff'
]

const DEFINITELY_OTHER = [
    'esl-puzzle-game',
    'explod',
    'alien-disco',
    'kettle',
    'okosban',
    'season-finale',
    'easy-enigma',
    'collapsable-sokoban'

]

const LARGE_MAP_SIZE = 500
const LONG_GAME_LEVELS = 10
const SHORT_GAME_LEVELS = 6

const browseGamesList = getElement('#browseGamesList')

function createEl(tagName: string, classes: Optional<string[]>, attributes?: Optional<{[key: string]: string}>, children?: (Element | string | null)[]) {
    const el = document.createElement(tagName)
    classes && classes.forEach((cls) => el.classList.add(cls))
    if (attributes) {
        for (const key of Object.keys(attributes)) {
            el.setAttribute(key, attributes[key])
        }
    }
    if (children) {
        children.forEach((child) => {
            if (typeof child === 'string') {
                el.appendChild(document.createTextNode(child))
            } else if (child) {
                el.appendChild(child)
            }
        })
    }
    return el
}

export function browseGames() {
    browseGamesList.innerHTML = ''
    // populate the divs with a list of all the games
    const categoryContinue = []
    const categoryPopular = []
    const categoryLarge = []
    const categoryGradual = []
    const categoryNoPreface = []
    const categoryShort = []
    const categoryMedium = []
    const categoryOther = []
    const allGames = new Map<string, GameInfo>()
    const continueGames = new Map<string, StorageGameInfo>()
    ALL_GAMES.forEach((info, gameId) => allGames.set(gameId, info))

    currentInfo.forEachGame((gameId, item) => {
        continueGames.set(gameId, item)
    })

    for (const gameInfo of allGames.values()) {
        const { id: gameId, title, author, backgroundColor, popularColors, levels } = gameInfo
        const authorMarkup = author ? createEl('div', ['game-author'], null, [`by ${author}`]) : null
        const htmlSnippet = createEl('a', null, { href: `#/${gameId}`, title }, [
            createEl('figure', null, { 'id': gameId, 'aria-hidden': 'true' }, [
                createEl('div', ['thumbnail-wrapper'], { style: `background-color: ${backgroundColor || popularColors[0]}` }, [
                    createEl('img', ['game-thumbnail'], { src: `./game-thumbnails/${gameId}.png` })
                ]),
                createEl('figcaption', null, null, [
                    createEl('div', ['game-title'], null, [title]),
                    authorMarkup
                ])
            ])
        ])

        const maxMapSize = Math.max(...levels.map((l) => l ? l.rows * l.cols : 0))
        const mapCount = levels.filter((l) => !!l).length
        const hasPreface = !levels[0]
        if (continueGames.has(gameId)) {
            categoryContinue.push(htmlSnippet)
        } else if (DEFINITELY_OTHER.includes(gameId)) {
            categoryOther.push(htmlSnippet)
        } else if (POPULAR_GAMES.includes(gameId)) {
            categoryPopular.push(htmlSnippet)
        } else if (maxMapSize >= LARGE_MAP_SIZE) {
            categoryLarge.push(htmlSnippet)
        } else if (mapCount >= LONG_GAME_LEVELS) {
            categoryGradual.push(htmlSnippet)
        } else if (!hasPreface) {
            categoryNoPreface.push(htmlSnippet)
        } else if (mapCount <= SHORT_GAME_LEVELS) {
            categoryShort.push(htmlSnippet)
        } else {
            categoryMedium.push(htmlSnippet)
        }

    }

    function buildCategory(title: string, items: Element[]) {
        if (items.length > 0) {
            browseGamesList.appendChild(createEl('h2', ['category-title'], null, [title]))
            browseGamesList.appendChild(createEl('div', ['category-games'], null, items))
        }
    }

    buildCategory('Continue Playing', categoryContinue)
    buildCategory('Popular Games', categoryPopular)
    buildCategory('Progressively Challenging Games', categoryGradual)
    buildCategory('Large Games', categoryLarge)
    buildCategory('Short Games', categoryShort)
    buildCategory('Medium-length Games', categoryMedium)
    buildCategory('Games without Instructions', categoryNoPreface)
    buildCategory('Uncategorized Games', categoryOther)
}
