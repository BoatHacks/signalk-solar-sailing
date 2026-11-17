// Headless screenshots of the webapp (signalk-visuals 12). Dev only.
//
//   node scripts/screenshots.mjs <base url> <name> [device] [offline] [history]
//     [fixture|fixture-log] [night] [today] [screen] [#chart|#sources] [?query]
//
// `device` is an id from scripts/devices.mjs (vulcan-9fs, waveshare-7b,
// phone, laptop; `desktop` = laptop), default laptop. `screen` captures only
// the viewport, i.e. what the display shows without scrolling; otherwise the
// whole page. `?query` is added to the URL (e.g. ?layout=normal).
//
// Run against a development Signal K server with simulated data, never the
// boat's own. `history` answers the History API with a synthetic curve so the
// chart can be shown without a history provider; `offline` refuses the
// WebSocket so the banner shows. `fixture` / `fixture-log` serve public/ and
// simulated plugin data (scripts/fixture.mjs) with no server at all: forecast
// without a speed log, or with a learned speed model and a route. `night`
// sends environment.mode night; `#chart` / `#sources` open that phone tab.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { serveFixture, syntheticHistory } from './fixture.mjs'
import { DEVICES, device } from './devices.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const [base, name, deviceId = 'laptop', ...flags] = process.argv.slice(2)
const dev = device(deviceId)
if (!base || !name || !dev) {
  console.error('usage: screenshots.mjs <base url> <name> [device] [flags]; devices: ' + Object.keys(DEVICES).join(', '))
  process.exit(2)
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: dev.viewport, deviceScaleFactor: dev.dpr })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  // A missing history provider answers 501, which the page handles.
  if (m.type() === 'error' && !/status of (404|501)/.test(m.text())) errors.push(m.text())
})
let stopFixture = () => {}
const variant = flags.includes('fixture-log') ? 'log' : flags.includes('fixture') ? 'winter' : undefined
if (variant) {
  stopFixture = await serveFixture(page, base, variant, { night: flags.includes('night'), offline: flags.includes('offline') })
} else if (flags.includes('offline')) {
  await page.routeWebSocket(/signalk\/v1\/stream/, (ws) => ws.close())
}
if (flags.includes('history')) {
  await page.route('**/signalk/v2/api/history/values**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(syntheticHistory(route.request().url())) }))
}
const hash = flags.find((f) => f.startsWith('#')) || ''
const query = flags.find((f) => f.startsWith('?')) || ''
await page.goto(base + query + hash, { waitUntil: 'load' })
if (flags.includes('today')) {
  await page.waitForTimeout(6000)
  // Also when the chart is on a hidden phone tab.
  await page.$eval('ss-chart button:last-child', (b) => b.click())
}
await page.waitForTimeout(flags.includes('offline') ? 2500 : 7000)
mkdirSync('docs/screenshots', { recursive: true })
await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: !flags.includes('screen') })
stopFixture()
await browser.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
console.log(`docs/screenshots/${name}.png`)
