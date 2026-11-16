// <ss-chart>: last 3 / 6 / 24 h of solar, motor and budget from the History
// API, as a hand-made SVG (ARCHITECTURE 2.9), plus a "Today" window from
// sunrise to sunset with the solar forecast, best hours and sunset (plan 12).
// ES2017.

import { store, el, setTheme } from '../context.js'
import { loadHistory } from '../api.js'
import { formatTime, offsetMinutes } from '../time.js'
import { withPrefix } from '../units.js'
import { toPoints, seriesPeak, todayWindow, forecastPoints, forecastPeak, xOf, toMs, CHART_W as W, CHART_H as H, CHART_PAD as PAD } from '../view.js'

const NS = 'http://www.w3.org/2000/svg'
const WINDOWS = [3, 6, 24, 'today']
const TODAY = 'today'
const REFRESH_MS = 60000
const LINES = [
  { key: 'solar', label: 'Solar', cls: 'l-solar' },
  { key: 'budget', label: 'Budget', cls: 'l-budget' },
  { key: 'motor', label: 'Motor', cls: 'l-motor' }
]

const svg = (tag, attrs) => {
  const e = document.createElementNS(NS, tag)
  Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]))
  return e
}

class SsChart extends HTMLElement {
  connectedCallback () {
    if (this.built) return
    this.built = true
    this.hours = 6
    this.panel = el('section', 'sk-card theme-offline chart')
    const head = el('div', 'chart-head')
    head.appendChild(el('p', 'label', 'History'))
    const toggle = el('div', 'toggle')
    this.buttons = WINDOWS.map((h) => {
      const b = el('button', '', h === TODAY ? 'Today' : h + ' h')
      b.setAttribute('type', 'button')
      b.setAttribute('aria-pressed', String(h === this.hours))
      b.addEventListener('click', () => this.setWindow(h))
      toggle.appendChild(b)
      return b
    })
    head.appendChild(toggle)
    this.panel.appendChild(head)

    this.svg = svg('svg', { viewBox: '0 0 ' + W + ' ' + H, preserveAspectRatio: 'none', class: 'plot', role: 'img', 'aria-label': 'Solar, budget and motor power' })
    this.grid = [0.25, 0.5, 0.75, 1].map((f) => {
      const y = H - PAD.b - f * (H - PAD.t - PAD.b)
      const line = svg('line', { x1: PAD.l, x2: W - PAD.r, y1: y, y2: y, class: 'grid' })
      this.svg.appendChild(line)
      return line
    })
    this.best = svg('rect', { class: 'best', x: 0, y: PAD.t, width: 0, height: H - PAD.t - PAD.b })
    this.svg.appendChild(this.best)
    this.lines = {}
    LINES.forEach((l) => {
      const pl = svg('polyline', { class: l.cls, fill: 'none', points: '' })
      this.svg.appendChild(pl)
      this.lines[l.key] = pl
    })
    this.forecast = svg('polyline', { class: 'l-forecast', fill: 'none', points: '' })
    this.svg.appendChild(this.forecast)
    this.sunset = svg('line', { class: 'sunset', x1: 0, x2: 0, y1: PAD.t, y2: H - PAD.b })
    this.svg.appendChild(this.sunset)
    this.nowLine = svg('line', { class: 'now', x1: 0, x2: 0, y1: PAD.t, y2: H - PAD.b })
    this.svg.appendChild(this.nowLine)
    this.panel.appendChild(this.svg)

    const axis = el('div', 'axis sub')
    this.tStart = el('span', '', '')
    this.yMax = el('span', 'mid', '')
    this.tEnd = el('span', 'right', '')
    axis.appendChild(this.tStart)
    axis.appendChild(this.yMax)
    axis.appendChild(this.tEnd)
    this.panel.appendChild(axis)

    const legend = el('div', 'legend sub')
    this.todayLegend = []
    LINES.concat([
      { key: 'forecast', label: 'Forecast', cls: 'l-forecast' },
      { key: 'best', label: 'Best hours', cls: 'k-best' },
      { key: 'sunset', label: 'Sunset', cls: 'k-sunset' }
    ]).forEach((l) => {
      const item = el('span', 'item')
      item.appendChild(el('i', l.cls))
      item.appendChild(document.createTextNode(l.label))
      legend.appendChild(item)
      if (l.key === 'forecast') this.forecastLegend = item
      if (l.key === 'best' || l.key === 'sunset') this.todayLegend.push(item)
    })
    this.panel.appendChild(legend)
    this.note = el('div', 'note', 'Loading history…')
    this.panel.appendChild(this.note)
    this.appendChild(this.panel)

    this.onVisible = () => { if (!document.hidden) this.load() }
    document.addEventListener('visibilitychange', this.onVisible)
    this.off = store.subscribe(['environment.time.timezoneOffset', 'connected', 'status'], (k, v) => {
      if (k === 'connected' && v && this.state !== 'ok') this.load()
      else if (k === 'status') this.onStatus()
      else this.draw()
    })
    this.onStatus()
    this.load()
  }

  disconnectedCallback () {
    if (this.off) this.off()
    document.removeEventListener('visibilitychange', this.onVisible)
    if (this.timer) clearTimeout(this.timer)
    this.built = false
  }

  setWindow (h) {
    this.hours = h
    this.buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(WINDOWS[i] === h)))
    this.load()
  }

  /** The Today button only shows once the plugin knows the sunset. */
  onStatus () {
    const st = store.get('status')
    const has = Boolean(st && st.snapshot && toMs(st.snapshot.sunset) !== undefined)
    this.buttons[WINDOWS.indexOf(TODAY)].hidden = !has
    if (!has && this.hours === TODAY) this.setWindow(6)
    else if (this.hours === TODAY) this.draw()
  }

  /** Window bounds for the current button: `{ t0, t1 }`. */
  span (now) {
    if (this.hours === TODAY) {
      const st = store.get('status')
      const w = st && st.snapshot ? todayWindow(st.snapshot, now, this.tz()) : undefined
      if (w) return w
      return { t0: now - 6 * 3600000, t1: now }
    }
    return { t0: now - this.hours * 3600000, t1: now }
  }

  tz () {
    const r = store.get('environment.time.timezoneOffset')
    return r ? offsetMinutes(r.value) : undefined
  }

  async load () {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { if (!document.hidden) this.load() }, REFRESH_MS)
    const key = this.hours
    const now = Date.now()
    const w = this.span(now)
    // History back to the window start; the Today window may start after now (before sunrise).
    const hours = key === TODAY ? Math.max(1, Math.ceil((now - w.t0) / 3600000)) : key
    const res = await loadHistory((u) => fetch(u, { credentials: 'same-origin' }), hours)
    if (key !== this.hours) return
    this.state = res.state
    this.points = res.points
    this.loadedAt = Date.now()
    if (res.state === 'ok' && key !== TODAY) store.set('historyPeak', Math.max(seriesPeak({ solar: [], motor: res.points.motor, budget: res.points.budget }), 0))
    this.draw()
  }

  draw () {
    const p = this.points
    const notes = {
      none: 'No history provider. Install one such as signalk-questdb to see the chart.',
      empty: 'No history recorded yet for this window.',
      error: 'History could not be loaded.'
    }
    const ok = this.state === 'ok' && p
    this.note.textContent = ok ? '' : (notes[this.state] || 'Loading history…')
    this.note.hidden = Boolean(ok)
    setTheme(this.panel, ok ? 'theme-teal' : 'theme-offline')
    const now = this.hours === TODAY ? Date.now() : (this.loadedAt || Date.now())
    const w = this.span(now)
    const t0 = w.t0
    const t1 = w.t1
    const today = this.hours === TODAY
    const st = store.get('status')
    const snap = (st && st.snapshot) || {}
    const hours = today && st && st.forecast && !st.forecast.stale ? st.forecast.hours : null
    const ymax = Math.max(ok ? seriesPeak(p) : 100, forecastPeak(hours)) * 1.1
    LINES.forEach((l) => this.lines[l.key].setAttribute('points', ok ? toPoints(p.t, p[l.key], t0, t1, ymax) : ''))
    this.forecast.setAttribute('points', hours ? forecastPoints(hours, now, t0, t1, ymax) : '')
    this.forecastLegend.hidden = !hours
    this.todayLegend[0].hidden = !(today && snap.bestHours)
    this.todayLegend[1].hidden = !today
    const marker = (node, t) => {
      const show = today && t !== undefined && t >= t0 && t <= t1
      node.setAttribute('visibility', show ? 'visible' : 'hidden')
      if (show) {
        const x = xOf(t, t0, t1).toFixed(1)
        node.setAttribute('x1', x)
        node.setAttribute('x2', x)
      }
    }
    marker(this.sunset, toMs(snap.sunset))
    marker(this.nowLine, now)
    const best = snap.bestHours
    const b0 = best ? Math.max(best.start, t0) : 0
    const b1 = best ? Math.min(best.end, t1) : 0
    const showBest = today && best && b1 > b0
    this.best.setAttribute('visibility', showBest ? 'visible' : 'hidden')
    if (showBest) {
      this.best.setAttribute('x', xOf(b0, t0, t1).toFixed(1))
      this.best.setAttribute('width', (xOf(b1, t0, t1) - xOf(b0, t0, t1)).toFixed(1))
    }
    const tz = this.tz()
    this.tStart.textContent = formatTime(t0, tz)
    this.tEnd.textContent = formatTime(t1, tz)
    const top = withPrefix(ymax, 'W')
    this.yMax.textContent = ok ? 'top ' + top.text + ' ' + top.unit : ''
  }
}

customElements.define('ss-chart', SsChart)
