// Display units (signalk-visuals 6): meta.displayUnits through a safe formula
// parser, ISO prefixes otherwise. Pure, runs in Node for tests. ES2017 only.

/**
 * Parse a display-unit formula such as "value * 60" or "(value - 273.15)".
 * Only numbers, `value`, + - * / ^ and parentheses are accepted; anything
 * else returns undefined so the caller falls back to SI. Never eval.
 * @param {string} src
 * @returns {((value: number) => number) | undefined}
 */
export function parseFormula (src) {
  if (typeof src !== 'string' || src.length > 200) return undefined
  const tokens = []
  const re = /\s*(?:(\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)|(value)|([-+*/^()]))/y
  let pos = 0
  const trimmed = src.replace(/\s+$/, '')
  while (pos < trimmed.length) {
    re.lastIndex = pos
    const m = re.exec(trimmed)
    if (!m) return undefined
    if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) })
    else if (m[2] !== undefined) tokens.push({ t: 'var' })
    else tokens.push({ t: 'op', v: m[3] })
    pos = re.lastIndex
  }
  let i = 0
  const peek = () => tokens[i]
  const isOp = (v) => peek() && peek().t === 'op' && peek().v === v

  // expr := term (('+'|'-') term)*
  // term := unary (('*'|'/') unary)*
  // unary := '-' unary | '+' unary | power
  // power := atom ('^' unary)?
  // atom := num | value | '(' expr ')'
  function expr () {
    let left = term()
    while (left && (isOp('+') || isOp('-'))) {
      const op = tokens[i++].v
      const right = term()
      if (!right) return undefined
      const l = left
      left = op === '+' ? (x) => l(x) + right(x) : (x) => l(x) - right(x)
    }
    return left
  }
  function term () {
    let left = unary()
    while (left && (isOp('*') || isOp('/'))) {
      const op = tokens[i++].v
      const right = unary()
      if (!right) return undefined
      const l = left
      left = op === '*' ? (x) => l(x) * right(x) : (x) => l(x) / right(x)
    }
    return left
  }
  function unary () {
    if (isOp('-')) {
      i++
      const u = unary()
      return u ? (x) => -u(x) : undefined
    }
    if (isOp('+')) {
      i++
      return unary()
    }
    return power()
  }
  function power () {
    const base = atom()
    if (base && isOp('^')) {
      i++
      const exp = unary()
      if (!exp) return undefined
      return (x) => Math.pow(base(x), exp(x))
    }
    return base
  }
  function atom () {
    const tok = tokens[i]
    if (!tok) return undefined
    if (tok.t === 'num') {
      i++
      const v = tok.v
      return () => v
    }
    if (tok.t === 'var') {
      i++
      return (x) => x
    }
    if (tok.t === 'op' && tok.v === '(') {
      i++
      const e = expr()
      if (!e || !isOp(')')) return undefined
      i++
      return e
    }
    return undefined
  }

  const fn = expr()
  if (!fn || i !== tokens.length) return undefined
  return fn
}

const PREFIXES = [
  { f: 1e9, p: 'G' },
  { f: 1e6, p: 'M' },
  { f: 1e3, p: 'k' },
  { f: 1, p: '' }
]

/** Units that take an ISO prefix when shown. */
const PREFIXABLE = { W: true, Wh: true, J: true, m: true, Hz: false }

/**
 * About three significant figures, no grouping, no trailing zeros.
 * @param {number} v
 */
export function round3 (v) {
  if (v === 0) return '0'
  const abs = Math.abs(v)
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  const s = v.toFixed(digits)
  return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s
}

/**
 * `1200 W` → `{ text: '1.2', unit: 'kW' }`.
 * @param {number} value
 * @param {string} unit
 */
export function withPrefix (value, unit) {
  if (!PREFIXABLE[unit]) return { text: round3(value), unit: unit }
  const abs = Math.abs(value)
  for (let k = 0; k < PREFIXES.length; k++) {
    const pr = PREFIXES[k]
    if (abs >= pr.f || pr.f === 1) {
      return { text: round3(value / pr.f), unit: pr.p + unit }
    }
  }
  return { text: round3(value), unit: unit }
}

/**
 * Format a published SI value for display using the path's meta.
 * Missing values give '-' (never 0 or NaN).
 * @param {number | null | undefined} value
 * @param {{ units?: string, displayUnits?: { formula?: string, symbol?: string } } | undefined} meta
 * @returns {{ text: string, unit: string }}
 */
export function formatValue (value, meta) {
  const m = meta || {}
  const si = m.units || ''
  if (typeof value !== 'number' || !isFinite(value)) return { text: '-', unit: '' }
  const du = m.displayUnits
  if (du && du.formula && du.symbol && du.formula.replace(/\s/g, '') !== 'value') {
    const fn = parseFormula(du.formula)
    if (fn) {
      const v = fn(value)
      if (isFinite(v)) return withPrefix(v, du.symbol)
    }
  }
  if (si === 'Hz' && !du) return { text: round3(value * 60), unit: 'rpm' }
  return withPrefix(value, si)
}
