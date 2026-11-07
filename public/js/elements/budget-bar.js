// <ss-budget-bar>: motor draw against the solar budget (SPEC 6.1). The
// scale is the day's peak of budget and motor seen so far. ES2017.

import { store, el, setTheme, metaOf, P, isFresh } from '../context.js'
import { matchTheme } from '../state.js'
import { formatValue } from '../units.js'

const fmt = (key, v) => {
  const f = formatValue(v, metaOf(key) || { units: 'W' })
  return f.text + (f.unit ? ' ' + f.unit : '')
}

class SsBudgetBar extends HTMLElement {
  connectedCallback () {
    if (this.built) return
    this.built = true
    this.peak = 100
    this.panel = el('section', 'sk-card theme-offline budget-bar')
    this.panel.appendChild(el('p', 'label', 'Motor vs budget'))
    this.track = el('div', 'track')
    this.fill = el('i', 'fill')
    this.marker = el('b', 'marker')
    this.marker.setAttribute('title', 'Solar budget')
    this.track.appendChild(this.fill)
    this.track.appendChild(this.marker)
    this.panel.appendChild(this.track)
    const scale = el('div', 'scale sub')
    this.left = el('span', '', 'Motor -')
    this.right = el('span', 'right', 'Budget -')
    scale.appendChild(this.left)
    scale.appendChild(this.right)
    this.panel.appendChild(scale)
    this.appendChild(this.panel)
    this.off = store.subscribe(['tick', 'connected', 'meta', 'historyPeak', P + 'budget', P + 'motorPower', P + 'matchState', 'notifications.solarsailing.overBudget'], () => this.render())
    this.render()
  }

  disconnectedCallback () {
    if (this.off) this.off()
    this.built = false
  }

  render () {
    const now = Date.now()
    const connected = Boolean(store.get('connected'))
    const b = store.get(P + 'budget')
    const m = store.get(P + 'motorPower')
    const ms = store.get(P + 'matchState')
    const bf = isFresh(b, now, connected)
    const mf = isFresh(m, now, connected)
    const peak = Math.max(this.peak, store.get('historyPeak') || 0, bf ? b.value : 0, mf ? m.value : 0)
    this.peak = peak
    const pct = (v) => Math.max(0, Math.min(100, (v / peak) * 100)) + '%'
    const n = store.get('notifications.solarsailing.overBudget')
    const alarm = Boolean(n && n.value && n.value.state === 'warn')
    const fresh = isFresh(ms, now, connected)
    setTheme(this.panel, bf && mf ? (fresh && ms.value !== 'unknown' ? matchTheme(ms.value, alarm, true) : 'theme-teal') : 'theme-offline')
    this.fill.style.width = mf ? pct(m.value) : '0%'
    this.marker.style.left = bf ? pct(b.value) : '0%'
    this.marker.hidden = !bf
    this.left.textContent = 'Motor ' + fmt('motorPower', mf ? m.value : undefined)
    this.right.textContent = 'Budget ' + fmt('budget', bf ? b.value : undefined)
  }
}

customElements.define('ss-budget-bar', SsBudgetBar)
