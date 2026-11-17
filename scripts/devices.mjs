// The displays the webapp runs on aboard (issue #10). Used by
// scripts/screenshots.mjs and scripts/contact-sheet.mjs; the README table
// follows this list. Viewport in CSS pixels as the page sees it (window
// innerWidth × innerHeight), not the native panel. Open the webapp with
// `?size` on a device to read its viewport and pixel ratio in the top bar.

/**
 * @typedef {object} Device
 * @property {string} name
 * @property {string} [panel] native panel resolution
 * @property {{ width: number, height: number }} viewport CSS px
 * @property {number} dpr device pixel ratio
 * @property {string} engine browser and version floor
 * @property {'touch' | 'buttons' | 'mouse' | 'touch, buttons'} input
 * @property {'helm' | 'nav station' | 'cockpit'} where
 * @property {boolean} confirmed viewport measured on the device itself
 * @property {string} [query] URL query to use on this device
 * @property {string} [notes]
 */

/** @type {Record<string, Device>} */
export const DEVICES = {
  'vulcan-9fs': {
    name: 'B&G Vulcan 9 FS',
    panel: '800 × 480',
    viewport: { width: 670, height: 430 },
    dpr: 1,
    engine: 'Chromium 69 (floor)',
    input: 'touch, buttons',
    where: 'helm',
    confirmed: false,
    notes: 'Assumed (Tobi, 2026-11-17): 40 px title bar and a ~130 px instrument bar on the right, ' +
      'measured from a B&G marketing image. Confirm with ?size on the plotter and correct this entry.'
  },
  'waveshare-7b': {
    name: 'Waveshare ESP32-P4 7" via signalk-espos-stream',
    panel: '1024 × 600',
    viewport: { width: 1024, height: 600 },
    dpr: 1,
    engine: 'current Chromium kiosk (Xvfb), streamed as MJPEG ≤ 15 fps',
    input: 'touch',
    where: 'helm',
    confirmed: false,
    query: '?motion=off',
    notes: 'espos-stream default capture size. JPEG softens thin lines and small text; ' +
      'animations cost frames, so the capture URL should add ?motion=off.'
  },
  phone: {
    name: 'Phone',
    viewport: { width: 390, height: 844 },
    dpr: 3,
    engine: 'current Chromium / Safari',
    input: 'touch',
    where: 'cockpit',
    confirmed: true
  },
  laptop: {
    name: 'Nav station laptop',
    viewport: { width: 1280, height: 860 },
    dpr: 1,
    engine: 'current Chromium',
    input: 'mouse',
    where: 'nav station',
    confirmed: true
  }
}

/** Older names still accepted by the scripts. */
export const ALIASES = { desktop: 'laptop' }

/**
 * @param {string} id device id or alias
 * @returns {Device | undefined}
 */
export function device (id) {
  const key = Object.prototype.hasOwnProperty.call(ALIASES, id) ? ALIASES[id] : id
  return Object.prototype.hasOwnProperty.call(DEVICES, key) ? DEVICES[key] : undefined
}
