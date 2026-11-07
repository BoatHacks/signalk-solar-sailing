// <ss-match>: match state word and icon, balance (SPEC 6.1). ES2017.

import { store, el, setTheme, metaOf, P, isFresh } from '../context.js'
import { matchTheme } from '../state.js'
import { formatValue } from '../units.js'

const WORDS = {
  matched: ['✓', 'On the sun'],
  under: ['▼', 'Under budget'],
  over: ['▲', 'Over budget'],
  unknown: ['–', 'Not in drive']
}

const fmt = (key, v) => {
  const f = formatValue(v, metaOf(key) || { units: 'W' })
  return f.text + (f.unit ? ' ' + f.unit : '')
}

class SsMatch extends HTMLElement {
  connectedCallback () {
    if (this.built) return
    this.built = true
    this.panel = el('section', 'sk-card strong match theme-offline')
    this.panel.setAttribute('role', 'status')
    this.panel.appendChild(el('p', 'label', 'Match'))
    const row = el('div', 'match-row')
    this.icon = el('span', 'match-icon', '–')
    this.icon.setAttribute('aria-hidden', 'true')
    this.word = el('span', 'match-word', 'No data')
    row.appendChild(this.icon)
    row.appendChild(this.word)
    this.panel.appendChild(row)
    this.balance = el('div', 'value balance')
    this.panel.appendChild(this.balance)
    this.sub = el('div', 'sub', '')
    this.panel.appendChild(this.sub)
    this.appendChild(this.panel)
    this.off = store.subscribe(['tick', 'connected', 'meta', P + 'matchState', P + 'balance', P + 'budget', P + 'motorPower', 'notifications.solarsailing.overBudget'], () => this.render())
    this.render()
  }

  disconnectedCallback () {
    if (this.off) this.off()
    this.built = false
  }

  render () {
    const now = Date.now()
    const connected = Boolean(store.get('connected'))
    const ms = store.get(P + 'matchState')
    const fresh = isFresh(ms, now, connected)
    const state = fresh ? ms.value : undefined
    const n = store.get('notifications.solarsailing.overBudget')
    const alarm = Boolean(n && n.value && n.value.state && n.value.state !== 'normal' && n.value.state !== 'nominal')
    setTheme(this.panel, matchTheme(state, alarm, fresh))
    this.panel.classList.toggle('pulse', fresh && alarm)
    const w = fresh ? (WORDS[state] || WORDS.unknown) : ['–', connected ? 'No data' : 'Offline']
    this.icon.textContent = w[0]
    this.word.textContent = w[1]

    const bal = store.get(P + 'balance')
    const balFresh = fresh && state !== 'unknown' && isFresh(bal, now, connected)
    let text = '-'
    if (balFresh) {
      const v = bal.value
      text = (v >= 0 ? '+' : '−') + fmt('balance', Math.abs(v))
    }
    if (this.balance.textContent !== text) this.balance.textContent = text

    const budget = store.get(P + 'budget')
    const motor = store.get(P + 'motorPower')
    let sub = 'Budget ' + fmt('budget', isFresh(budget, now, connected) ? budget.value : undefined)
    if (balFresh) sub = (bal.value >= 0 ? 'Spare sun. ' : 'Drawing from the battery. ') + sub
    if (isFresh(motor, now, connected)) sub += ', motor ' + fmt('motorPower', motor.value)
    if (this.sub.textContent !== sub) this.sub.textContent = sub
  }
}

customElements.define('ss-match', SsMatch)
