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
 */
export function buildStatus (snapshot, readings, propeller) {
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
      battery: b ? { id: b.id, path: b.path, soc: b.soc, watts: b.watts, stale: b.stale, timestamp: iso(b.time) } : null,
      dcSystem: readings.dcSystem ? { ...readings.dcSystem, time: undefined, timestamp: iso(readings.dcSystem.time) } : null
    },
    propeller
  }
}

/** @param {number | undefined} t */
function iso (t) {
  return t === undefined ? undefined : new Date(t).toISOString()
}
