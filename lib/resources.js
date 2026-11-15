// Read-only resource provider: GET /signalk/v2/api/resources/solar-sailing/status
// (SPEC 5.2, ARCHITECTURE 2.8). Readable anonymously under allow_readonly,
// unlike plugin routes.

export const RESOURCE_TYPE = 'solar-sailing'

/**
 * @param {() => object | undefined} getStatus
 */
export function resourceMethods (getStatus) {
  const status = () => getStatus() || { available: false }
  return {
    /** @param {unknown} _query */
    listResources: async (_query) => ({ status: status() }),
    /** @param {string} id */
    getResource: async (id) => {
      if (id !== 'status') throw new Error(`No such resource: ${id}`)
      return status()
    },
    setResource: async () => { throw new Error('solar-sailing resources are read-only') },
    deleteResource: async () => { throw new Error('solar-sailing resources are read-only') }
  }
}

/**
 * Snapshot plus per-source breakdown for the webapp.
 * @param {import('./types.js').Snapshot | undefined} snapshot
 * @param {import('./types.js').Readings | undefined} readings
 * @param {{ k?: number, n: number, samples: number, ready: boolean }} propeller
 * @param {object} [speed] speed model state (plan 11)
 */
export function buildStatus (snapshot, readings, propeller, speed) {
  if (!snapshot || !readings) return undefined
  const m = readings.motor
  const b = readings.battery
  return {
    available: true,
    timestamp: new Date(snapshot.t).toISOString(),
    snapshot,
    sources: {
      solar: readings.solar.map((s) => ({ id: s.id, path: s.path, watts: s.watts, via: s.via, stale: s.stale, timestamp: iso(s.time) })),
      solarFallback: readings.solarFallback,
      motor: m
        ? {
            id: m.id,
            path: m.path,
            watts: m.watts,
            via: m.via,
            rpm: m.rpm,
            direction: m.direction,
            gearRatio: m.gearRatio,
            inDrive: m.inDrive,
            temperatures: m.temperatures,
            stale: m.stale,
            timestamp: iso(m.time)
          }
        : null,
      battery: b ? { id: b.id, path: b.path, soc: b.soc, watts: b.watts, capacityWh: b.capacityWh, stale: b.stale, timestamp: iso(b.time) } : null,
      dcSystem: readings.dcSystem ? { ...readings.dcSystem, time: undefined, timestamp: iso(readings.dcSystem.time) } : null,
      position: readings.position
        ? { latitude: readings.position.lat, longitude: readings.position.lon, stale: readings.position.stale, timestamp: iso(readings.position.time) }
        : null,
      stw: readings.stw ? { mps: readings.stw.mps, stale: readings.stw.stale, timestamp: iso(readings.stw.time) } : null,
      navState: readings.navState ?? null,
      course: readings.course
        ? { nextM: readings.course.nextM, routeM: readings.course.routeM ?? null, stale: readings.course.stale, timestamp: iso(readings.course.time) }
        : null
    },
    forecast: forecastCurve(readings.forecast, snapshot),
    propeller,
    speed: speed || null
  }
}

/**
 * Speed model state for the webapp's learning hint.
 * @param {import('./speed.js').SpeedModel} model
 */
export function speedStatus (model) {
  const r = model.xRange()
  const suggestion = model.ratios.suggestion()
  return {
    ready: model.ready,
    samples: model.samples.length,
    c: model.coef ?? null,
    m: model.exp,
    minPowerW: r ? r.min : null,
    maxPowerW: r ? r.max : null,
    stwFactor: model.yScale,
    stwFactorSuggested: suggestion ? suggestion.factor : null,
    stwFactorSpread: suggestion ? suggestion.spread : null,
    stwFactorSectors: suggestion ? suggestion.sectors : null
  }
}

/** Most forecast slots sent to the webapp. */
export const MAX_CURVE_HOURS = 24

/**
 * Trimmed forecast for the chart: average W per slot from now until sunset
 * plus one slot, so the webapp never subscribes to the predictor's large
 * JSON value.
 * @param {import('./types.js').ForecastReading | undefined} f
 * @param {import('./types.js').Snapshot} snapshot
 */
export function forecastCurve (f, snapshot) {
  if (!f) return null
  let hours = f.hours
  if (snapshot.sunset !== undefined && snapshot.sunset > snapshot.t) {
    const sunset = snapshot.sunset
    const i = hours.findIndex((h) => h.t >= sunset)
    if (i >= 0) hours = hours.slice(0, i + 1)
  }
  return {
    status: f.status ?? null,
    stale: f.stale,
    timestamp: iso(f.time),
    age: f.time === undefined ? null : Math.round((snapshot.t - f.time) / 1000),
    hours: hours.slice(0, MAX_CURVE_HOURS).map((h) => ({ t: iso(h.t), solarW: h.solarWh, houseW: h.houseWh }))
  }
}

/** @param {number | undefined} t */
function iso (t) {
  return t === undefined ? undefined : new Date(t).toISOString()
}
