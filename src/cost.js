// Turning token counts into money.
//
// Pricing is not exposed by the API — there is no endpoint to ask — so this
// table is maintained by hand and will go stale. Everything here is written so
// that a stale or missing rate degrades to "report the tokens and say nothing
// about cost", never to a confident wrong number.

// US dollars per million tokens, from Anthropic's pricing page, 2026-08-25.
// Keys are matched by exact model id first, then by prefix, so dated snapshots
// (claude-haiku-4-5-20251001) resolve to their family.
const RATES = {
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5': { input: 10, output: 50 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5': { input: 3, output: 15 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-4-5': { input: 1, output: 5 }
}

export function rateFor(model, overrides = {}) {
  // An explicit override wins: rates differ on partner platforms, and this is
  // the escape hatch when the table above is out of date.
  if (overrides.input > 0 && overrides.output > 0)
    return { input: overrides.input, output: overrides.output }

  if (RATES[model]) return RATES[model]

  let prefix = Object.keys(RATES).find(id => model?.startsWith(id))

  return prefix ? RATES[prefix] : null
}

export function costOf({ input = 0, output = 0 }, rate) {
  if (!rate) return null
  return (input * rate.input + output * rate.output) / 1e6
}

export function formatCost(usd) {
  if (usd == null) return null
  // Cents are the smallest unit worth showing, but a real run that rounds to
  // zero should not read as free.
  if (usd < 0.005) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

export function formatTokens(n) {
  if (n == null) return '—'
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(1)}k`
}

// What a run cost, or — before it runs — what it is likely to cost. `output`
// is the only guess: thinking tokens are billed as output and vary with
// effort, so the caller supplies an allowance per page.
export function describe({ input, output, rate, estimated = false }) {
  let usd = formatCost(costOf({ input, output }, rate))

  let tokens = estimated ?
    `${formatTokens(input)} tokens in; output estimated` :
    `${formatTokens(input)} in, ${formatTokens(output)} out`

  if (usd == null)
    return `${tokens} — no published rate for this model, so see your ` +
      'Anthropic usage page'

  return `${usd} (${tokens})`
}
