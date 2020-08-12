/** @jest-environment puppeteer */
/* eslint-env jasmine */
import { existsSync, writeFileSync } from 'fs'
import lighthouse from 'lighthouse' // tslint:disable-line:no-implicit-dependencies
import reporter from 'lighthouse/lighthouse-core/report/report-generator' // tslint:disable-line:no-implicit-dependencies no-submodule-imports
import { join } from 'path'
import puppeteer from 'puppeteer' // tslint:disable-line:no-implicit-dependencies
import { URL } from 'url'
import { browserAfterEach, browserBeforeEach, getUrl } from './browserSpecUtils'
// import mapStackTrace from 'sourcemapped-stacktrace-node')

// Defined via jest-puppeteer environment
declare var browser: puppeteer.Browser

export const checkLighthouse = async(urlPath: string) => {

    const { port } = (new URL(browser.wsEndpoint()))
    const { lhr } = await lighthouse(getUrl(urlPath), { port })

    // Save the report so it can be viewed. Because running it in a browser yields different results
    const coveragePath = join(__dirname, '../../coverage/')
    if (existsSync(coveragePath)) {
        const html = reporter.generateReportHtml(lhr)
        writeFileSync(join(coveragePath, 'lighthouse-report.html'), html, { encoding: 'utf-8' })
    }

    expect(lhr.categories.seo.score).not.toBeNull() // The audit failed. Maybe XHTML parsing problem?
    expect(lhr.categories.accessibility.score).toBeGreaterThanOrEqual(1)
    expect(lhr.categories.seo.score).toBeGreaterThanOrEqual(1)
    expect(lhr.categories.pwa.score).toBeGreaterThanOrEqual(0.73) // since it is not https
    expect(lhr.categories['best-practices'].score).toBeGreaterThanOrEqual(0.64)
    expect(lhr.categories.performance.score).toBeGreaterThanOrEqual(0.80)
}

describe('Browser', () => {

    beforeEach(browserBeforeEach)
    afterEach(browserAfterEach)

    it('runs a Lighthouse Audit', async() => {
        jest.setTimeout(60 * 1000)
        await checkLighthouse('/index.xhtml')
    })

})
