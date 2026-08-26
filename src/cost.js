// Turning token counts into money.
//
// The prices themselves are not here: they live in `pricing.json`, because
// they change on Anthropic's schedule rather than this plugin's, and there is
// no endpoint to ask — no part of the API reports what a model costs. This
// file is only the arithmetic, and it is written so that a stale or missing
// rate degrades to "report the tokens and say nothing about money", never to a
// confident wrong number.

// The table is passed in rather than imported, so that this file has no
// opinion about what anything costs and can be tested without a build.

export function rateFor(model, { rates = {}, overrides = {} } = {}) {
  // An explicit override wins: rates differ on partner platforms and under
  // enterprise agreements, and it is the escape hatch when `pricing.json` has
  // gone stale in an installed copy that cannot be rebuilt.
  if (overrides.input > 0 && overrides.output > 0)
    return { input: overrides.input, output: overrides.output }

  if (rates[model]) return rates[model]

  let prefix = Object.keys(rates).find(id => model?.startsWith(id))

  return prefix ? rates[prefix] : null
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
export function describe({ input, output, rate, estimated = false, pricedOn }) {
  let usd = formatCost(costOf({ input, output }, rate))

  let tokens = estimated ?
    `${formatTokens(input)} tokens in; output estimated` :
    `${formatTokens(input)} in, ${formatTokens(output)} out`

  if (usd == null)
    return `${tokens} — no published rate for this model, so see your ` +
      'Anthropic usage page'

  // Saying when the prices were checked is the difference between a figure and
  // a figure you can decide whether to trust.
  return `${usd} (${tokens}${pricedOn ? `, at ${pricedOn} prices` : ''})`
}
