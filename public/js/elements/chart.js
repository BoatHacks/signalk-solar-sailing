// <ss-chart>: last 3 / 6 / 24 h of solar, motor and budget from the History
// API, as a hand-made SVG (ARCHITECTURE 2.9). ES2017.

import { store, el, setTheme } from '../context.js'
import { loadHistory } from '../api.js'
import { formatTime, offsetMinutes } from '../time.js'
import { withPrefix } from '../units.js'
import { toPoints, seriesPeak, CHART_W as W, CHART_H as H, CHART_PAD as PAD } from '../view.js'

const NS = 'http://www.w3.org/2000/svg'
const WINDOWS = [3, 6, 24]
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
      const b = el('button', '', h + ' h')
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
    this.lines = {}
    LINES.forEach((l) => {
      const pl = svg('polyline', { class: l.cls, fill: 'none', points: '' })
      this.svg.appendChild(pl)
      this.lines[l.key] = pl
    })
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
    LINES.forEach((l) => {
      const item = el('span', 'item')
      item.appendChild(el('i', l.cls))
      item.appendChild(document.createTextNode(l.label))
      legend.appendChild(item)
    })
    this.panel.appendChild(legend)
    this.note = el('div', 'note', 'Loading history…')
    this.panel.appendChild(this.note)
    this.appendChild(this.panel)

    this.onVisible = () => { if (!document.hidden) this.load() }
    document.addEventListener('visibilitychange', this.onVisible)
    this.off = store.subscribe(['environment.time.timezoneOffset', 'connected'], (k, v) => {
      if (k === 'connected' && v && this.state !== 'ok') this.load()
      else this.draw()
    })
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

  async load () {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => { if (!document.hidden) this.load() }, REFRESH_MS)
    const hours = this.hours
    const res = await loadHistory((u) => fetch(u, { credentials: 'same-origin' }), hours)
    if (hours !== this.hours) return
    this.state = res.state
    this.points = res.points
    this.loadedAt = Date.now()
    if (res.state === 'ok') store.set('historyPeak', Math.max(seriesPeak({ solar: [], motor: res.points.motor, budget: res.points.budget }), 0))
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
    const t1 = this.loadedAt || Date.now()
    const t0 = t1 - this.hours * 3600000
    const ymax = ok ? seriesPeak(p) * 1.1 : 1000
    LINES.forEach((l) => this.lines[l.key].setAttribute('points', ok ? toPoints(p.t, p[l.key], t0, t1, ymax) : ''))
    const r = store.get('environment.time.timezoneOffset')
    const tz = r ? offsetMinutes(r.value) : undefined
    this.tStart.textContent = formatTime(t0, tz)
    this.tEnd.textContent = formatTime(t1, tz)
    const top = withPrefix(ymax, 'W')
    this.yMax.textContent = ok ? 'top ' + top.text + ' ' + top.unit : ''
  }
}

customElements.define('ss-chart', SsChart)
