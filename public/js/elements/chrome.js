// <ss-topbar> and <ss-offline>: page chrome and the offline banner
// (signalk-visuals 3, 5). ES2017.

import { store, el, P } from '../context.js'
import { formatAge, formatDate, formatTime, offsetMinutes } from '../time.js'

const tz = () => {
  const r = store.get('environment.time.timezoneOffset')
  return r ? offsetMinutes(r.value) : undefined
}

class SsTopbar extends HTMLElement {
  connectedCallback () {
    if (this.built) return
    this.built = true
    const header = el('header', 'topbar')
    header.appendChild(el('h1', '', 'Solar Sailing'))
    const chrome = el('div', 'chrome')
    this.age = el('span', 'age mono', 'No data')
    this.link = el('span', 'link')
    this.dot = el('i', 'dot')
    this.linkText = el('span', '', 'Connecting')
    this.link.appendChild(this.dot)
    this.link.appendChild(this.linkText)
    this.clock = el('span', 'clock mono', '')
    this.clock.title = 'Ship time, or UTC with Z'
    this.date = el('span', 'mono date', '')
    chrome.appendChild(this.age)
    chrome.appendChild(this.link)
    chrome.appendChild(this.clock)
    chrome.appendChild(this.date)
    header.appendChild(chrome)
    this.appendChild(header)
    this.off = store.subscribe(['tick', 'connected'], () => this.render())
    this.render()
  }

  disconnectedCallback () {
    if (this.off) this.off()
    this.built = false
  }

  render () {
    const now = Date.now()
    const connected = store.get('connected')
    const latest = store.get(P + 'matchState')
    this.age.textContent = latest ? 'Updated ' + formatAge(now - latest.t) + ' ago' : 'No data'
    this.link.className = 'link ' + (connected ? 'up' : 'down')
    this.linkText.textContent = connected ? 'Server online' : (connected === false ? 'Server lost' : 'Connecting')
    const offsetMin = tz()
    this.clock.textContent = formatTime(now, offsetMin)
    this.date.textContent = formatDate(now, offsetMin)
  }
}

class SsOffline extends HTMLElement {
  connectedCallback () {
    if (this.built) return
    this.built = true
    this.banner = el('div', 'banner sk-card strong theme-red', '')
    this.banner.setAttribute('role', 'alert')
    this.banner.hidden = true
    this.appendChild(this.banner)
    this.off = store.subscribe(['tick', 'connected', 'retryAt', 'authNeeded'], () => this.render())
    this.render()
  }

  disconnectedCallback () {
    if (this.off) this.off()
    this.built = false
  }

  render () {
    const down = store.get('connected') === false
    this.banner.hidden = !down
    if (!down) return
    const at = store.get('retryAt')
    const secs = at ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : 0
    let text = 'Connection to the Signal K server lost. ' + (secs > 0 ? 'Retrying in ' + secs + ' s.' : 'Retrying now.')
    if (store.get('authNeeded')) text += ' The server may need a login: enable read-only access or sign in.'
    if (this.banner.textContent !== text) this.banner.textContent = text
  }
}

customElements.define('ss-topbar', SsTopbar)
customElements.define('ss-offline', SsOffline)
