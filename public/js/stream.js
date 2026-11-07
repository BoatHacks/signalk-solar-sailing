// One throttled WebSocket to the Signal K stream (ARCHITECTURE 2.9,
// signalk-visuals 5). ES2017.

import { backoffDelay } from './backoff.js'

export const PREFIX = 'plugin.solarsailing.'

/** The single subscription the page sends after connecting. */
export function subscription () {
  return {
    context: 'vessels.self',
    subscribe: [
      { path: PREFIX + '*', period: 1000, minPeriod: 1000 },
      { path: 'notifications.solarsailing.overBudget', period: 1000, minPeriod: 1000 },
      { path: 'environment.mode', period: 5000, minPeriod: 5000 },
      { path: 'environment.time.timezoneOffset', period: 5000, minPeriod: 5000 }
    ]
  }
}

/**
 * Values from one stream message; anything that is not an
 * `updates[].values[]` delta yields [].
 * @param {string} text
 * @returns {Array<{ path: string, value: any }>}
 */
export function parseDelta (text) {
  let msg
  try {
    msg = JSON.parse(text)
  } catch (e) {
    return []
  }
  if (!msg || !Array.isArray(msg.updates)) return []
  const out = []
  for (let i = 0; i < msg.updates.length; i++) {
    const u = msg.updates[i]
    if (!u || !Array.isArray(u.values)) continue
    for (let j = 0; j < u.values.length; j++) {
      const v = u.values[j]
      if (v && typeof v.path === 'string') out.push({ path: v.path, value: v.value })
    }
  }
  return out
}

/** Stream URL for the page's own origin. */
export function streamUrl (loc) {
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
  return proto + '//' + loc.host + '/signalk/v1/stream?subscribe=none'
}

/**
 * Keeps one socket open, writes values into the store as `{ value, t }`,
 * and `connected` / `retryAt` for the offline banner.
 */
export class Stream {
  /**
   * @param {import('./state.js').Store} store
   * @param {string} url
   * @param {{ WebSocket?: any, now?: () => number, random?: () => number,
   *   setTimeout?: Function, clearTimeout?: Function }} [deps]
   */
  constructor (store, url, deps) {
    const d = deps || {}
    this.store = store
    this.url = url
    this.WS = d.WebSocket || (typeof WebSocket !== 'undefined' ? WebSocket : undefined)
    this.now = d.now || Date.now
    this.random = d.random || Math.random
    this.setTimeout = d.setTimeout || setTimeout.bind(null)
    this.clearTimeout = d.clearTimeout || clearTimeout.bind(null)
    this.attempt = 0
    this.ws = undefined
    this.timer = undefined
    this.closed = false
  }

  start () {
    this.closed = false
    this.connect()
  }

  stop () {
    this.closed = true
    if (this.timer) this.clearTimeout(this.timer)
    if (this.ws) this.ws.close()
  }

  connect () {
    if (this.closed || !this.WS) return
    let ws
    try {
      ws = new this.WS(this.url)
    } catch (e) {
      this.retry()
      return
    }
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      ws.send(JSON.stringify(subscription()))
      this.store.set('connected', true)
      this.store.set('retryAt', undefined)
    }
    ws.onmessage = (ev) => {
      const t = this.now()
      const values = parseDelta(String(ev.data))
      for (let i = 0; i < values.length; i++) {
        this.store.set(values[i].path, { value: values[i].value, t: t })
      }
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.ws = undefined
      this.store.set('connected', false)
      this.retry()
    }
    ws.onerror = () => {
      try { ws.close() } catch (e) { /* closing anyway */ }
    }
  }

  retry () {
    if (this.closed) return
    const delay = backoffDelay(this.attempt++, this.random())
    this.store.set('retryAt', this.now() + delay)
    this.timer = this.setTimeout(() => this.connect(), delay)
  }
}
