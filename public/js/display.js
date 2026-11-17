// Page options from the URL and the compact landscape layout for short
// helm screens (issue #10). Pure functions, ES2017.

/** Viewports at most this tall in landscape get the compact layout. */
export const COMPACT_MAX_HEIGHT = 640

/**
 * Options from the query string:
 * - `layout=compact` / `layout=normal` forces a layout (default: automatic);
 * - `size` shows the viewport (CSS px) and device pixel ratio in the top bar,
 *   to measure a plotter's browser;
 * - `motion=off` stops animations and transitions, e.g. for an MJPEG stream.
 * @param {string} search location.search
 * @returns {{ layout: 'compact' | 'normal' | undefined, size: boolean, reduceMotion: boolean }}
 */
export function pageOptions (search) {
  const q = new URLSearchParams(String(search || ''))
  const layout = q.get('layout')
  const motion = q.get('motion')
  return {
    layout: layout === 'compact' || layout === 'normal' ? layout : undefined,
    size: q.has('size') && q.get('size') !== '0' && q.get('size') !== 'off',
    reduceMotion: motion === 'off' || motion === 'reduce' || motion === '0'
  }
}

/**
 * Layout for a viewport: compact on short landscape screens (Vulcan 9 FS
 * 670 × 430, Waveshare 7" 1024 × 600, a phone turned sideways), else normal.
 * @param {number} width CSS px
 * @param {number} height CSS px
 * @param {'compact' | 'normal'} [forced]
 * @returns {'compact' | 'normal'}
 */
export function layoutFor (width, height, forced) {
  if (forced) return forced
  return width > height && height <= COMPACT_MAX_HEIGHT ? 'compact' : 'normal'
}

/**
 * Viewport readout such as 670×430 at 1x, e.g. for the Vulcan.
 * @param {number} width
 * @param {number} height
 * @param {number} dpr
 */
export function sizeText (width, height, dpr) {
  const r = Math.round((dpr || 1) * 100) / 100
  return Math.round(width) + '×' + Math.round(height) + ' @' + r + 'x'
}
