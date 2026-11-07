import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDelta, subscription, Stream, streamUrl } from '../../public/js/stream.js'
import { historyUrl, parseHistory, parseMeta, loadHistory } from '../../public/js/api.js'
import { Store } from '../../public/js/state.js'

test('parseDelta is defensive', () => {
  assert.deepEqual(parseDelta('{"updates":[{"values":[{"path":"a","value":1}]}]}'), [{ path: 'a', value: 1 }])
  assert.deepEqual(parseDelta('not json'), [])
  assert.deepEqual(parseDelta('{"name":"server hello"}'), [])
  assert.deepEqual(parseDelta('{"updates":[{"meta":[]},null,{"values":[{"value":1}]}]}'), [])
})

test('subscription is throttled', () => {
  for (const s of subscription().subscribe) {
    assert.ok(s.period >= 1000 && s.minPeriod >= 1000, s.path)
  }
  assert.equal(streamUrl({ protocol: 'https:', host: 'boat:3000' }), 'wss://boat:3000/signalk/v1/stream?subscribe=none')
})

test('stream: stores values, flags offline and schedules a backoff retry', () => {
  const sockets = []
  class FakeWS {
    constructor (url) { this.url = url; this.sent = []; sockets.push(this) }
    send (m) { this.sent.push(m) }
    close () { if (this.onclose) this.onclose() }
  }
  const timers = []
  const store = new Store()
  const s = new Stream(store, 'ws://x', { WebSocket: FakeWS, now: () => 1000, random: () => 0, setTimeout: (fn, ms) => { timers.push([fn, ms]); return timers.length }, clearTimeout: () => {} })
  s.start()
  sockets[0].onopen()
  assert.equal(store.get('connected'), true)
  assert.ok(JSON.parse(sockets[0].sent[0]).subscribe.length > 0)
  sockets[0].onmessage({ data: '{"updates":[{"values":[{"path":"plugin.solarsailing.budget","value":300}]}]}' })
  assert.deepEqual(store.get('plugin.solarsailing.budget'), { value: 300, t: 1000 })
  sockets[0].close()
  assert.equal(store.get('connected'), false)
  assert.equal(store.get('retryAt'), 2000)
  assert.equal(timers[0][1], 1000)
  timers[0][0]()
  assert.equal(sockets.length, 2)
  s.stop()
})

test('history url and parsing', () => {
  const url = historyUrl(6)
  assert.ok(url.indexOf('duration=PT6H') > 0)
  assert.ok(url.indexOf('resolution=60') > 0)
  assert.ok(decodeURIComponent(url).indexOf('plugin.solarsailing.solarPower:average') > 0)
  const p = parseHistory({
    values: [{ path: 'plugin.solarsailing.budget' }, { path: 'plugin.solarsailing.solarPower' }],
    data: [['2026-11-07T10:00:00Z', 300, 500], ['bad', 1, 2], [Date.parse('2026-11-07T10:01:00Z'), null, 520]]
  })
  assert.deepEqual(p.t, [Date.parse('2026-11-07T10:00:00Z'), Date.parse('2026-11-07T10:01:00Z')])
  assert.deepEqual(p.solar, [500, 520])
  assert.deepEqual(p.budget, [300, null])
  assert.deepEqual(p.motor, [null, null])
  assert.deepEqual(parseHistory(null).t, [])
})

test('loadHistory: no provider on 404/501, error otherwise', async () => {
  const reply = (status, body) => async () => ({ ok: status === 200, status, json: async () => body })
  assert.equal((await loadHistory(reply(404), 6)).state, 'none')
  assert.equal((await loadHistory(reply(501), 6)).state, 'none')
  assert.equal((await loadHistory(reply(500), 6)).state, 'error')
  assert.equal((await loadHistory(reply(200, { values: [], data: [] }), 6)).state, 'empty')
  assert.equal((await loadHistory(async () => { throw new Error('offline') }, 6)).state, 'error')
})

test('meta from the plugin subtree', () => {
  assert.deepEqual(parseMeta({ budget: { value: 1, meta: { units: 'W' } }, x: 5 }), { budget: { units: 'W' } })
})
