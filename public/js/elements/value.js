// <ss-value label="Solar" key="solarPower" sub-key="..." sub-label="...">
// Generic big-number panel. ES2017.

import { store, el, setTheme, metaOf, P, isFresh } from '../context.js'
import { formatValue } from '../units.js'

/** @param {number | undefined} v */
const signed = (v) => (typeof v === 'number' && isFinite(v) ? (v >= 0 ? '+' : '') : '')

/**
 * Motor RPM from the status resource, rounded, when fresh.
 * @param {any} status
 */
const motorRpm = (status) => {
  const m = status && status.available && status.sources && status.sources.motor
  return m && !m.stale && typeof m.rpm === 'number' && isFinite(m.rpm) ? String(Math.round(m.rpm)) : undefined
}

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
    this.sub2Key = this.getAttribute('sub2-key')
    if (this.sub2Key) keys.push(P + this.sub2Key, 'status')
    this.nowRpm = this.hasAttribute('now-rpm')
    if (this.nowRpm) keys.push('status')
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
      let text = s ? label + ' ' + (this.hasAttribute('signed') ? signed(sf ? s.value : undefined) : '') + sv.text + (sv.unit ? ' ' + sv.unit : '') : (this.getAttribute('hint') || '')
      // Second sub value (forecast bias, plan 12): only while a forecast is in.
      const status = store.get('status')
      const s2 = this.sub2Key ? store.get(P + this.sub2Key) : undefined
      if (s2 && status && status.forecast && isFresh(s2, now, connected)) {
        const v2 = formatValue(Math.abs(s2.value), metaOf(this.sub2Key))
        const word = status.snapshot && status.snapshot.forecastStatus ? ' (' + status.snapshot.forecastStatus + ')' : ''
        text += ' · ' + (this.getAttribute('sub2-label') || '') + ' ' + signed(s2.value) + v2.text + (v2.unit ? ' ' + v2.unit : '') + word
      }
      // Live motor RPM from the status poll next to the target (Tobi, 2026-11-16).
      const rpm = this.nowRpm ? motorRpm(store.get('status')) : undefined
      if (rpm !== undefined) text = 'Now ' + rpm + ' rpm · ' + text
      if (this.sub.textContent !== text) this.sub.textContent = text
    }
  }
}

customElements.define('ss-value', SsValue)
