// <ss-sources>: per-MPPT, motor and battery breakdown from the status
// resource (SPEC 6.1). Rows are cached by id and updated in place. ES2017.

import { store, el, setTheme } from '../context.js'
import { sourceRows } from '../view.js'

class SsSources extends HTMLElement {
  connectedCallback () {
    if (this.built) return
    this.built = true
    this.panel = el('section', 'sk-card theme-offline')
    this.panel.appendChild(el('p', 'label', 'Sources'))
    this.table = el('table', 'kv')
    this.body = el('tbody')
    this.table.appendChild(this.body)
    this.panel.appendChild(this.table)
    this.empty = el('div', 'sub', 'Waiting for the plugin…')
    this.panel.appendChild(this.empty)
    this.appendChild(this.panel)
    /** @type {Object<string, { tr: HTMLElement, k: HTMLElement, v: HTMLElement }>} */
    this.rows = {}
    this.off = store.subscribe(['status', 'connected'], () => this.render())
    this.render()
  }

  disconnectedCallback () {
    if (this.off) this.off()
    this.built = false
  }

  render () {
    const status = store.get('status')
    const connected = Boolean(store.get('connected'))
    const rows = sourceRows(status)
    const seen = {}
    for (let i = 0; i < rows.length; i++) {
      const id = rows[i][0]
      seen[id] = true
      let r = this.rows[id]
      if (!r) {
        const tr = el('tr')
        const k = el('td')
        const v = el('td')
        tr.appendChild(k)
        tr.appendChild(v)
        r = this.rows[id] = { tr: tr, k: k, v: v }
      }
      if (this.body.children[i] !== r.tr) this.body.insertBefore(r.tr, this.body.children[i] || null)
      if (r.k.textContent !== rows[i][1]) r.k.textContent = rows[i][1]
      if (r.v.textContent !== rows[i][2]) r.v.textContent = rows[i][2]
      r.tr.className = rows[i][3] ? 'stale' : ''
    }
    Object.keys(this.rows).forEach((id) => {
      if (!seen[id]) {
        const tr = this.rows[id].tr
        if (tr.parentNode) tr.parentNode.removeChild(tr)
        delete this.rows[id]
      }
    })
    this.empty.hidden = rows.length > 0
    setTheme(this.panel, connected && rows.length ? 'theme-teal' : 'theme-offline')
  }
}

customElements.define('ss-sources', SsSources)
