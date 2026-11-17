// Renders every display in scripts/devices.mjs from the simulated fixture
// into one contact sheet, to review the layouts before a release (issue #10).
// Dev only.
//
//   node scripts/contact-sheet.mjs [fixture|fixture-log] [night] [out.png]
//
// Each tile is what that display shows without scrolling, at 1 CSS px per
// pixel. Default: fixture-log, day, docs/screenshots/contact-sheet.png.
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { serveFixture, syntheticHistory } from './fixture.mjs'
import { DEVICES } from './devices.mjs'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const variant = args.includes('fixture') ? 'winter' : 'log'
const night = args.includes('night')
const out = args.find((a) => a.endsWith('.png')) || 'docs/screenshots/contact-sheet.png'
const base = 'http://fixture.test/signalk-solar-sailing/'

const browser = await chromium.launch()
const tiles = []
for (const [id, d] of Object.entries(DEVICES)) {
  const page = await browser.newPage({ viewport: d.viewport, deviceScaleFactor: 1 })
  const stop = await serveFixture(page, base, variant, { night })
  await page.route('**/signalk/v2/api/history/values**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(syntheticHistory(route.request().url())) }))
  await page.goto(base + (d.query || ''), { waitUntil: 'load' })
  await page.waitForTimeout(7000)
  const png = await page.screenshot()
  stop()
  await page.close()
  tiles.push({ id, d, src: 'data:image/png;base64,' + png.toString('base64') })
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const html = '<!doctype html><meta charset="utf-8"><style>' +
  'body{margin:0;padding:16px;background:#202428;color:#ddd;font:13px system-ui,sans-serif}' +
  '.row{display:flex;align-items:flex-start;flex-wrap:wrap}' +
  'figure{margin:0 16px 16px 0}figcaption{margin-bottom:6px}b{color:#fff}' +
  'img{display:block;border:1px solid #555}</style><div class="row">' +
  tiles.map((t) => '<figure><figcaption><b>' + esc(t.d.name) + '</b> · ' + t.d.viewport.width + '×' +
    t.d.viewport.height + ' · ' + esc(t.d.where) + (t.d.confirmed ? '' : ' · unconfirmed') +
    '</figcaption><img src="' + t.src + '" width="' + t.d.viewport.width + '"></figure>').join('') +
  '</div>'
const sheet = await browser.newPage({ viewport: { width: 2400, height: 900 } })
await sheet.setContent(html)
mkdirSync(dirname(out), { recursive: true })
await sheet.screenshot({ path: out, fullPage: true })
await browser.close()
console.log(out)
