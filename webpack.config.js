const path = require('path')
const WorkboxPlugin = require('workbox-webpack-plugin')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const ScriptExtHtmlWebpackPlugin = require('script-ext-html-webpack-plugin')

module.exports = {
    mode: process.env['NODE_ENV'] || 'production',
    entry: {
        'pwa-app': './src/pwa/app.ts',
        'puzzlescript-webworker': './src/index-webworker.ts',
        'puzzlescript': './src/index-browser.ts',
    },
    output: {
        path: path.resolve(__dirname, './'),
        filename: '[name].js',
    },
    devtool: 'source-map',
    resolve: {
        // Add '.ts' and '.tsx' as resolvable extensions.
        extensions: ['.ts', '.tsx', '.js', '.json'],
        alias: {
            // TODO: There should only be 1 sfxr entry
            './sound/sfxr': path.resolve(__dirname, './src/sound/sfxr-browser'),
            '../sound/sfxr': path.resolve(__dirname, './src/sound/sfxr-browser'),
            '../ui/terminal': path.resolve(__dirname, './src/ui/terminalBrowserShim.js')
        }
    },
    plugins: [
        new HtmlWebpackPlugin({
            minify: false,
            xhtml: true,
            cache: true,
            template: 'pwa-template.xhtml',
            filename: 'index.xhtml',
            inject: 'head',
            chunks: ['pwa-app']
        }),
        new ScriptExtHtmlWebpackPlugin({
            // defaultAttribute: 'async' // Does not work for XHTML files
            custom: {
                test: /pwa-app/,
                attribute: 'async',
                value: 'async'
            }
        }),
        new WorkboxPlugin.GenerateSW({
            // these options encourage the ServiceWorkers to get in there fast 
            // and not allow any straggling "old" SWs to hang around
            clientsClaim: true,
            skipWaiting: true,
            offlineGoogleAnalytics: true,
            directoryIndex: 'index.xhtml',
            swDest: 'pwa-service-worker.js',
            runtimeCaching: [{
                urlPattern: /\/games\//,
                handler: 'StaleWhileRevalidate',
                options: {
                    cacheName: 'games-v1',
                    cacheableResponse: {
                        statuses: [0, 200]
                    }
                }
            },
            {
                urlPattern: /\/game-thumbnails\//,
                handler: 'StaleWhileRevalidate',
                options: {
                    cacheName: 'game-thumbnails-v1',
                    cacheableResponse: {
                        statuses: [0, 200]
                    }
                }
            },
            {
                urlPattern: /\/style\.css/,
                handler: 'StaleWhileRevalidate',
                options: {
                    cacheName: 'app-v1',
                    cacheableResponse: {
                        statuses: [0, 200]
                    }
                }
            },
            {
                urlPattern: /\/favicon\.ico/,
                handler: 'StaleWhileRevalidate',
                options: {
                    cacheName: 'app-icons-v1',
                    cacheableResponse: {
                        statuses: [0, 200]
                    }
                }
            },
            {
                urlPattern: /\/apple-.*\.png/,
                handler: 'StaleWhileRevalidate',
                options: {
                    cacheName: 'app-icons-v1',
                    cacheableResponse: {
                        statuses: [0, 200]
                    }
                }
            },

        ]
            
        })
    ],
    module: {
        rules: [
            { 
                test: /\.(js|mjs|jsx|ts|tsx)$/,
                loader: require.resolve('babel-loader'),
                options: {
                    presets: ['@babel/preset-env'],
                    cacheDirectory: true,
                    // Save disk space when time isn't as important
                    cacheCompression: true,
                    compact: true,
                }
            }
        ]
    },
}