// <ss-range>: speed at budget, range until sunset and the course targets
// (plan 12). Always shown; greyed out with dashes without a speed log.
// Data from the 5 s status poll. ES2017.

import { store, el, setTheme, metaOf } from '../context.js'
import { rangeView } from '../view.js'
import { offsetMinutes } from '../time.js'

class SsRange extends HTMLElement {
  connectedCallback () {
    if (this.built) return
    this.built = true
    this.panel = el('section', 'sk-card theme-offline range')
    this.panel.appendChild(el('p', 'label', 'Range'))
    const value = el('div', 'value')
    this.num = el('span', 'num', '-')
    this.unit = el('small', '', 'kn')
    value.appendChild(this.num)
    value.appendChild(this.unit)
    this.panel.appendChild(value)
    this.sub = el('div', 'sub', '')
    this.panel.appendChild(this.sub)
    this.list = el('ul', 'targets')
    this.panel.appendChild(this.list)
    this.hint = el('div', 'sub hint', '')
    this.panel.appendChild(this.hint)
    this.appendChild(this.panel)
    this.off = store.subscribe(['status', 'connected', 'meta', 'environment.time.timezoneOffset'], () => this.render())
    this.render()
  }

  disconnectedCallback () {
    if (this.off) this.off()
    this.built = false
  }

  render () {
    const connected = Boolean(store.get('connected'))
    const r = store.get('environment.time.timezoneOffset')
    const v = rangeView(store.get('status'), r ? offsetMinutes(r.value) : undefined, metaOf)
    if (this.num.textContent !== v.speed) this.num.textContent = v.speed
    if (this.unit.textContent !== v.unit) this.unit.textContent = v.unit
    if (this.sub.textContent !== v.sub) this.sub.textContent = v.sub
    this.hint.textContent = v.hint
    this.hint.hidden = !v.hint
    while (this.list.children.length > v.lines.length) this.list.removeChild(this.list.lastChild)
    for (let i = 0; i < v.lines.length; i++) {
      let li = this.list.children[i]
      if (!li) li = this.list.appendChild(el('li', ''))
      if (li.textContent !== v.lines[i]) li.textContent = v.lines[i]
    }
    this.list.hidden = !v.lines.length
    setTheme(this.panel, connected && v.state === 'ready' ? 'theme-teal' : 'theme-offline')
  }
}

customElements.define('ss-range', SsRange)
