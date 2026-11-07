// Page entry: wires the stream, REST polls, day/night and phone tabs. ES2017.

import { store } from './context.js'
import { Stream, streamUrl } from './stream.js'
import { loadMeta, loadStatus, STATUS_URL } from './api.js'
import { tabFromHash } from './state.js'
import './elements/chrome.js'
import './elements/match.js'
import './elements/budget-bar.js'
import './elements/value.js'
import './elements/energy.js'
import './elements/sources.js'
import './elements/chart.js'

const STATUS_POLL_MS = 5000
const getJson = (u) => fetch(u, { credentials: 'same-origin' })

// Day/night from environment.mode; only the literal "night" dims (signalk-visuals 2).
store.subscribe(['environment.mode'], (k, r) => {
  document.documentElement.setAttribute('data-mode', r && r.value === 'night' ? 'night' : 'day')
})

// Metadata (display units) once per connection.
store.subscribe(['connected'], (k, up) => {
  if (!up) return
  loadMeta(getJson).then((meta) => store.set('meta', meta))
})

// Breakdown from the resources API, paused while the page is hidden.
let statusTimer
function pollStatus () {
  if (statusTimer) clearTimeout(statusTimer)
  statusTimer = setTimeout(pollStatus, STATUS_POLL_MS)
  if (document.hidden) return
  loadStatus(getJson).then((s) => {
    if (s) store.set('status', s)
  })
  fetch(STATUS_URL, { method: 'HEAD', credentials: 'same-origin' }).then((r) => {
    store.set('authNeeded', r.status === 401 || r.status === 403)
  }).catch(() => {})
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) pollStatus() })

// Phone tabs (below 900 px): Values / Chart / Sources, kept in the hash.
function showTab () {
  const tab = tabFromHash(location.hash)
  document.body.setAttribute('data-tab', tab)
  const buttons = document.querySelectorAll('.tabs a')
  for (let i = 0; i < buttons.length; i++) {
    const b = buttons[i]
    b.setAttribute('aria-current', b.getAttribute('href') === '#' + tab ? 'page' : 'false')
  }
}
window.addEventListener('hashchange', showTab)
showTab()

// Ages and staleness are re-evaluated once a second.
setInterval(() => store.set('tick', Date.now()), 1000)

new Stream(store, streamUrl(location)).start()
pollStatus()
