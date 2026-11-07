// Headless screenshots of the webapp (signalk-visuals 12). Dev only.
//
//   node scripts/screenshots.mjs <base url> <name> [phone|desktop] [offline] [history]
//
// Run against a development Signal K server with simulated data, never the
// boat's own. `history` answers the History API with a synthetic curve so the
// chart can be shown without a history provider; `offline` refuses the
// WebSocket so the banner shows.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const [base, name, size = 'desktop', ...flags] = process.argv.slice(2)
const viewport = size === 'phone' ? { width: 390, height: 844 } : { width: 1280, height: 860 }

function syntheticHistory (url) {
  const hours = Number((/PT(\d+)H/.exec(url) || [])[1] || 6)
  const now = Date.now()
  const n = 360
  const data = []
  for (let i = 0; i <= n; i++) {
    const t = now - hours * 3600000 + (i / n) * hours * 3600000
    const f = i / n
    const sun = Math.max(0, 900 * Math.sin(Math.PI * (0.25 + 0.6 * f))) * (0.85 + 0.15 * Math.sin(i / 7))
    const motoring = f > 0.35 && f < 0.6 || f > 0.8
    const motor = motoring ? 380 + 40 * Math.sin(i / 5) : 0
    const budget = Math.max(0, sun * 0.92 - 60)
    data.push([new Date(t).toISOString(), Math.round(sun), Math.round(motor), Math.round(budget)])
  }
  return {
    context: 'vessels.self',
    range: { from: data[0][0], to: data[data.length - 1][0] },
    values: [
      { path: 'plugin.solarsailing.solarPower', method: 'average' },
      { path: 'plugin.solarsailing.motorPower', method: 'average' },
      { path: 'plugin.solarsailing.budget', method: 'average' }
    ],
    data
  }
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport, deviceScaleFactor: size === 'phone' ? 3 : 1 })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => {
  // A missing history provider answers 501, which the page handles.
  if (m.type() === 'error' && !/status of (404|501)/.test(m.text())) errors.push(m.text())
})
if (flags.includes('history')) {
  await page.route('**/signalk/v2/api/history/values**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(syntheticHistory(route.request().url())) }))
}
if (flags.includes('offline')) {
  await page.routeWebSocket(/signalk\/v1\/stream/, (ws) => ws.close())
}
await page.goto(base, { waitUntil: 'load' })
await page.waitForTimeout(flags.includes('offline') ? 2500 : 7000)
mkdirSync('docs/screenshots', { recursive: true })
await page.screenshot({ path: `docs/screenshots/${name}.png`, fullPage: true })
await browser.close()
if (errors.length) {
  console.error(errors.join('\n'))
  process.exitCode = 1
}
console.log(`docs/screenshots/${name}.png`)
