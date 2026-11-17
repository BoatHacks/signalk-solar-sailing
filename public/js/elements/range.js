// <ss-range>: speed at budget and range until sunset as two values, the
// course targets as a small table (plan 12, tidied for issue #10). Always
// shown; greyed out with dashes without a speed log. Data from the 5 s
// status poll. ES2017.

import { store, el, setTheme, metaOf } from '../context.js'
import { rangeView } from '../view.js'
import { offsetMinutes } from '../time.js'

const COLS = ['dist', 'eta', 'power', 'current']
const HEAD = ['', 'Dist', 'ETA', 'Power', 'Current']

class SsRange extends HTMLElement {
  connectedCallback () {
    if (this.built) return
    this.built = true
    this.panel = el('section', 'sk-card theme-offline range')
    this.panel.appendChild(el('p', 'label', 'Range'))
    const pair = el('div', 'pair')
    this.speed = this.cell(pair, 'Speed')
    this.range = this.cell(pair, 'To sunset')
    this.panel.appendChild(pair)
    this.sub = el('div', 'sub', '')
    this.panel.appendChild(this.sub)
    this.table = el('table', 'targets')
    const head = el('tr')
    HEAD.forEach((h) => head.appendChild(el('th', '', h)))
    const thead = el('thead')
    thead.appendChild(head)
    this.table.appendChild(thead)
    this.body = el('tbody')
    this.table.appendChild(this.body)
    this.panel.appendChild(this.table)
    this.appendChild(this.panel)
    this.off = store.subscribe(['status', 'connected', 'meta', 'environment.time.timezoneOffset'], () => this.render())
    this.render()
  }

  cell (parent, label) {
    const c = el('div', 'cell')
    c.appendChild(el('div', 'k', label))
    const v = el('div', 'value')
    const num = el('span', 'num', '-')
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
    const connected = Boolean(store.get('connected'))
    const r = store.get('environment.time.timezoneOffset')
    const v = rangeView(store.get('status'), r ? offsetMinutes(r.value) : undefined, metaOf)
    set(this.speed.num, v.speed)
    set(this.speed.unit, v.unit)
    set(this.range.num, v.range)
    set(this.range.unit, v.rangeUnit)
    set(this.sub, v.sub)
    while (this.body.children.length > v.targets.length) this.body.removeChild(this.body.lastChild)
    for (let i = 0; i < v.targets.length; i++) {
      const t = v.targets[i]
      let tr = this.body.children[i]
      if (!tr) {
        tr = this.body.appendChild(el('tr'))
        tr.appendChild(el('th', ''))
        COLS.forEach(() => tr.appendChild(el('td', '')))
      }
      set(tr.children[0], t.label)
      COLS.forEach((c, j) => set(tr.children[j + 1], t[c]))
      mark(tr.children[2], t.late, 'After sunset')
      mark(tr.children[3], t.over, 'Over the day budget')
    }
    this.table.hidden = !v.targets.length
    setTheme(this.panel, connected && v.state === 'ready' ? 'theme-teal' : 'theme-offline')
  }
}

function set (node, text) {
  if (node.textContent !== text) node.textContent = text
}

function mark (td, on, why) {
  td.className = on ? 'warn' : ''
  if (on) td.title = why
  else td.removeAttribute('title')
}

customElements.define('ss-range', SsRange)
