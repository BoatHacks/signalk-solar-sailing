// <ss-rpm>: target vs current motor RPM as two large values, target and
// current shaft RPM small below (Tobi, 2026-11-17). ES2017.

import { store, el, setTheme, P, isFresh } from '../context.js'
import { rpmView } from '../view.js'

class SsRpm extends HTMLElement {
  connectedCallback () {
    if (this.built) return
    this.built = true
    this.panel = el('section', 'sk-card theme-offline rpm')
    this.panel.appendChild(el('p', 'label', 'RPM'))
    const grid = el('div', 'pair')
    this.target = this.cell(grid, 'Target')
    this.current = this.cell(grid, 'Current')
    this.panel.appendChild(grid)
    this.sub = el('div', 'sub', 'Target learned while motoring')
    this.panel.appendChild(this.sub)
    this.appendChild(this.panel)
    this.off = store.subscribe(['tick', 'connected', 'status', P + 'targetRevolutions', P + 'targetShaftRevolutions'], () => this.render())
    this.render()
  }

  cell (parent, label) {
    const c = el('div', 'cell')
    c.appendChild(el('div', 'k', label))
    const v = el('div', 'value')
    const num = el('span', 'num', '-')
    v.appendChild(num)
    v.appendChild(el('small', '', 'rpm'))
    c.appendChild(v)
    parent.appendChild(c)
    return num
  }

  disconnectedCallback () {
    if (this.off) this.off()
    this.built = false
  }

  render () {
    const now = Date.now()
    const connected = Boolean(store.get('connected'))
    const t = store.get(P + 'targetRevolutions')
    const ts = store.get(P + 'targetShaftRevolutions')
    const tf = isFresh(t, now, connected)
    const v = rpmView(tf ? t.value : undefined, isFresh(ts, now, connected) ? ts.value : undefined, connected ? store.get('status') : undefined)
    if (this.target.textContent !== v.target) this.target.textContent = v.target
    if (this.current.textContent !== v.current) this.current.textContent = v.current
    const sub = v.shaft || 'Target learned while motoring'
    if (this.sub.textContent !== sub) this.sub.textContent = sub
    setTheme(this.panel, tf || v.current !== '-' ? 'theme-teal' : 'theme-offline')
  }
}

customElements.define('ss-rpm', SsRpm)
