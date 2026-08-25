// Checking the key and the model. Kept apart from `model.js` because none of
// it needs the prompt, which means it can be tested without a build step.

// A model is usable here only if it can read images and can be held to a JSON
// schema. Both are load-bearing: the pages go up as images, and the manifest
// comes back through `output_config.format`.
export function isUsable(model) {
  return Boolean(
    model?.capabilities?.image_input?.supported &&
    model?.capabilities?.structured_outputs?.supported)
}

// Check the key and the model before anything is rendered or billed.
//
// Listing models is the cheapest authenticated call there is — no tokens, and
// a bad key fails here rather than after sixty scans have been prepared. It
// also turns a mistyped model id into a list of the ones that would work,
// which matters while the model is a free-text field.
export async function verify(client, model) {
  let models = []

  try {
    for await (let m of client.models.list()) models.push(m)
  } catch (err) {
    if (err?.status === 401)
      throw new Error('the Anthropic API key was rejected')
    if (err?.status === 403)
      throw new Error('this Anthropic API key is not allowed to list models')

    throw new Error(`could not reach the Anthropic API: ${err.message}`)
  }

  let match = models.find(m => m.id === model)
  let usable = models.filter(isUsable)
  let names = () => usable.map(m => m.id).join(', ')

  if (match == null)
    throw new Error(
      `there is no model called "${model}". Models that would work: ${names()}`)

  if (!isUsable(match))
    throw new Error(
      `${match.display_name} cannot be used here — it does not support ` +
      `${match.capabilities?.image_input?.supported ?
        'structured outputs' : 'image input'}. ` +
      `Models that would work: ${names()}`)

  return match
}
