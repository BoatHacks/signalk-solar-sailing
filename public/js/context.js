// Shared page context: the store the elements read from. ES2017.

import { Store } from './state.js'

export const store = new Store()

/** Paths published by the plugin, without the prefix. */
export const P = 'plugin.solarsailing.'

/**
 * Create an element with a class and optional text.
 * @param {string} tag
 * @param {string} [cls]
 * @param {string} [text]
 */
export function el (tag, cls, text) {
  const e = document.createElement(tag)
  if (cls) e.className = cls
  if (text !== undefined) e.textContent = text
  return e
}

/**
 * Set a panel's theme class, replacing the previous theme-*.
 * @param {Element} node
 * @param {string} theme
 */
export function setTheme (node, theme) {
  const keep = node.className.split(' ').filter((c) => c && c.indexOf('theme-') !== 0)
  keep.push(theme)
  const next = keep.join(' ')
  if (node.className !== next) node.className = next
}

/**
 * Meta for a published key, from the store.
 * @param {string} key
 */
export function metaOf (key) {
  const meta = store.get('meta') || {}
  return meta[key]
}

/** Whether a value is fresh enough to colour, given the socket state. */
export { isFresh } from './state.js'
