// <ss-value label="Solar" key="solarPower" sub-key="..." sub-label="...">
// Generic big-number panel. ES2017.

import { store, el, setTheme, metaOf, P, isFresh } from '../context.js'
import { formatValue } from '../units.js'

class SsValue extends HTMLElement {
  connectedCallback () {
    if (this.built) return
    this.built = true
    this.key = this.getAttribute('key')
    this.subKey = this.getAttribute('sub-key')
    this.panel = el('section', 'sk-card theme-offline')
    this.panel.appendChild(el('p', 'label', this.getAttribute('label') || ''))
    const value = el('div', 'value')
    this.num = el('span', 'num', '-')
    this.unit = el('small', '', '')
    value.appendChild(this.num)
    value.appendChild(this.unit)
    this.panel.appendChild(value)
    this.sub = el('div', 'sub', this.getAttribute('hint') || '')
    this.panel.appendChild(this.sub)
    this.appendChild(this.panel)
    const keys = ['tick', 'connected', 'meta', P + this.key]
    if (this.subKey) keys.push(P + this.subKey)
    this.off = store.subscribe(keys, () => this.render())
    this.render()
  }

  disconnectedCallback () {
    if (this.off) this.off()
    this.built = false
  }

  render () {
    const now = Date.now()
    const connected = Boolean(store.get('connected'))
    const r = store.get(P + this.key)
    const fresh = isFresh(r, now, connected)
    const f = formatValue(fresh ? r.value : undefined, metaOf(this.key))
    if (this.num.textContent !== f.text) this.num.textContent = f.text
    if (this.unit.textContent !== f.unit) this.unit.textContent = f.unit
    setTheme(this.panel, fresh ? 'theme-teal' : 'theme-offline')
    if (this.subKey) {
      const s = store.get(P + this.subKey)
      const sf = isFresh(s, now, connected)
      const label = this.getAttribute('sub-label') || ''
      const sv = formatValue(sf ? s.value : undefined, metaOf(this.subKey))
      const text = s ? label + ' ' + sv.text + (sv.unit ? ' ' + sv.unit : '') : (this.getAttribute('hint') || '')
      if (this.sub.textContent !== text) this.sub.textContent = text
    }
  }
}

customElements.define('ss-value', SsValue)
