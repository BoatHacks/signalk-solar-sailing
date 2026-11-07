import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sourceRows, toPoints, seriesPeak, CHART_W, CHART_H, CHART_PAD } from '../../public/js/view.js'

test('breakdown rows from the status resource', () => {
  const rows = sourceRows({
    available: true,
    snapshot: { houseW: 52.6, houseSource: 'dcSystem' },
    sources: {
      solar: [{ id: '278', watts: 384, stale: false }, { id: '279', watts: 0, stale: true }],
      motor: { id: '99', watts: 1200, rpm: 1158.4, gearRatio: 2, direction: 1, temperatures: { temperature: 301.25 }, stale: false },
      battery: { id: '288', soc: 0.72, watts: -99.7, stale: false }
    },
    propeller: { ready: false, samples: 12, n: 3 }
  })
  const byId = Object.fromEntries(rows.map((r) => [r[0], r]))
  assert.equal(byId['solar-278'][2], '384 W')
  assert.deepEqual([byId['solar-279'][2], byId['solar-279'][3]], ['stale', true])
  assert.equal(byId.motor[2], '1.2 kW')
  assert.equal(byId.rpm[2], '1158')
  assert.equal(byId.gear[2], '2 : 1')
  assert.equal(byId.tmotor[2], '28.1 °C')
  assert.equal(byId.soc[2], '72 %')
  assert.equal(byId.house[1], 'House load (DC system power)')
  assert.equal(byId.prop[2], 'learning (12 samples)')
  assert.deepEqual(sourceRows(undefined), [])
  assert.deepEqual(sourceRows({ available: false }), [])
  const bare = sourceRows({ available: true, sources: {}, snapshot: {} })
  assert.equal(bare.find((r) => r[0] === 'motor')[2], 'not found')
})

test('chart points span the plot area and skip gaps', () => {
  const pts = toPoints([0, 50, 100], [0, null, 100], 0, 100, 100).split(' ')
  assert.equal(pts.length, 2)
  assert.equal(pts[0], `${CHART_PAD.l.toFixed(1)},${(CHART_H - CHART_PAD.b).toFixed(1)}`)
  assert.equal(pts[1], `${(CHART_W - CHART_PAD.r).toFixed(1)},${CHART_PAD.t.toFixed(1)}`)
  assert.equal(seriesPeak({ solar: [10, 900], motor: [null], budget: [] }), 900)
  assert.equal(seriesPeak({ solar: [], motor: [], budget: [] }), 100)
})
