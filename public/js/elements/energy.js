// <ss-energy>: solar in vs motor used today (SPEC 6.1). ES2017.

import { store, el, setTheme, metaOf, P, isFresh } from '../context.js'
import { formatValue } from '../units.js'

const ENERGY = { units: 'J', displayUnits: { formula: 'value / 3600', symbol: 'Wh' } }

class SsEnergy extends HTMLElement {
  connectedCallback () {
    if (this.built) return
    this.built = true
    this.panel = el('section', 'sk-card theme-offline energy')
    this.panel.appendChild(el('p', 'label', 'Energy today'))
    const grid = el('div', 'pair')
    this.solar = this.cell(grid, 'Solar in')
    this.motor = this.cell(grid, 'Motor used')
    this.panel.appendChild(grid)
    this.bar = el('div', 'bar')
    this.barFill = el('i', '')
    this.bar.appendChild(this.barFill)
    this.panel.appendChild(this.bar)
    this.sub = el('div', 'sub', '')
    this.panel.appendChild(this.sub)
    this.appendChild(this.panel)
    this.off = store.subscribe(['tick', 'connected', 'meta', P + 'solarEnergyToday', P + 'motorEnergyToday'], () => this.render())
    this.render()
  }

  cell (parent, label) {
    const c = el('div', 'cell')
    c.appendChild(el('div', 'k', label))
    const v = el('div', 'value small-value')
    const num = el('span', '', '-')
    const unit = el('small', '', '')
    v.appendChild(num)
    v.appendChild(unit)
    c.appendChild(v)
    parent.appendChild(c)
    return { num: num, unit: unit }
  }

  disconnectedCallback () {
    if (this.off) this.off()
    this.built = false
  }

  render () {
    const now = Date.now()
    const connected = Boolean(store.get('connected'))
    const s = store.get(P + 'solarEnergyToday')
    const m = store.get(P + 'motorEnergyToday')
    const sf = isFresh(s, now, connected)
    const mf = isFresh(m, now, connected)
    const show = (cell, key, r, fresh) => {
      // Without a resolved display unit, joules are shown as Wh / kWh, as on the battery monitor.
      const m = metaOf(key)
      const f = formatValue(fresh ? r.value : undefined, m && m.displayUnits && m.displayUnits.formula ? m : ENERGY)
      cell.num.textContent = f.text
      cell.unit.textContent = f.unit
    }
    show(this.solar, 'solarEnergyToday', s, sf)
    show(this.motor, 'motorEnergyToday', m, mf)
    setTheme(this.panel, sf && mf ? 'theme-teal' : 'theme-offline')
    const share = sf && mf && s.value > 0 ? Math.min(1, m.value / s.value) : 0
    this.barFill.style.width = Math.round(share * 100) + '%'
    this.sub.textContent = sf && mf && s.value > 0
      ? 'Motor used ' + Math.round((m.value / s.value) * 100) + ' % of today’s sun'
      : 'Since local midnight'
  }
}

customElements.define('ss-energy', SsEnergy)
