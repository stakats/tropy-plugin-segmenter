import Anthropic from '@anthropic-ai/sdk'
import { POLICY, RECORDING } from 'virtual:policy'

// The prompt is the two policy files, inlined from the repository root at
// build time (see rollup.config.mjs). Nothing about a particular collection —
// its calendar, its language, its document types — belongs in this file; it
// belongs in `segmentation.md` or `metadata.md`, which can be revised, or
// replaced for another archive, without touching any code.
//
// What is built here is only what cannot be written down in advance: the task
// framing, and the two things known solely at run time — the interface
// language, and the vocabulary this project already uses.
function system(language, vocabulary = [], notes = '') {
  return `${POLICY}

---

${RECORDING}

---

# This run

You are applying the policies above to a sequence of photos belonging to a
single batch-scanned item, in order. Each photo is labeled with its page
number.

Report the documents you find. Page numbers are the labels given to you, and
every document is a contiguous run of pages.

Record a confidence for each document. Use "low" whenever the boundary, the
date or the correspondent is uncertain — a later pass looks only at what you
flag, so an honest "low" costs little and a false "high" is not caught.

Leave covers, labels, rulers, color targets and folder shots unassigned.

## Language

The catalogue record follows the language of each document, as the recording
policy above describes.

\`note\` is the exception, because it is addressed to the person working in
Tropy rather than to the record. This person works in ${language}, so write
\`note\` in ${language}.

## The vocabulary of this project
${vocabulary.length > 0 ? `
These are the document types this project already uses:

${vocabulary.map(t => `- ${t}`).join('\n')}

Use one whenever it fits, copying its wording and capitalisation exactly, so
the field stays sortable. Coin a new term only when none of these describes the
document, and then match the language and style of the list above.` : `
This project has no document types recorded yet, so you are setting the
convention. Keep the terms short, singular and consistent across the dossier,
and in the language of the documents.`}
${notes ? `
---

# This collection

What follows was written by the person running this, about the particular
material you are looking at. It is additive: it makes the policies above
concrete, and where it is silent they still apply. Where it describes this
material more precisely than they do, follow it.

${notes}` : ''}`
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['documents', 'unassigned', 'openAtEnd'],
  properties: {
    documents: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['first', 'last', 'title', 'confidence'],
        properties: {
          first: { type: 'integer', description: 'first page of the document' },
          last: { type: 'integer', description: 'last page of the document' },
          title: { type: 'string' },
          date: {
            type: 'string',
            description:
              'the document\'s date, recorded as the policy above requires; ' +
              'empty if it carries none'
          },
          type: {
            type: 'string',
            description:
              'one short classification term — see the Document type section'
          },
          creator: { type: 'string' },
          recipient: { type: 'string' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: {
            type: 'string',
            description: 'for the reader, as the policy above describes'
          }
        }
      }
    },
    unassigned: {
      type: 'array',
      items: { type: 'integer' },
      description: 'pages that are not documents — covers, labels, targets'
    },
    openAtEnd: {
      type: 'boolean',
      description: 'true if the last document is still open at the last page'
    }
  }
}

export function createClient(apiKey) {
  if (!apiKey)
    throw new Error('no Anthropic API key configured in the plugin options')

  return new Anthropic({
    apiKey,

    // Tropy's renderer has `window`, `document` and `navigator`, so the SDK's
    // browser check trips — even though this is a desktop app with full Node,
    // the key belongs to the person running it, and it never leaves their
    // machine except to Anthropic. `contextIsolation` keeps page scripts out
    // of the world the plugin and the key live in.
    dangerouslyAllowBrowser: true,

    // Tropy loads its windows with `loadFile`, so requests carry `Origin:
    // null` and Chromium enforces CORS on them. Without this header the
    // preflight is answered 400 with no `access-control-allow-origin` and the
    // request never leaves; with it, 200 and `*`. The SDK does not send it.
    defaultHeaders: {
      'anthropic-dangerous-direct-browser-access': 'true'
    }
  })
}

// One pass over one window. `scans` are base64 JPEGs; `offset` is the position
// of the first scan in the dossier, so page labels are absolute throughout and
// windows can be reconciled without renumbering.
export function requestFor(scans, offset, options = {}) {
  let {
    model = 'claude-opus-5', effort = 'high', language = 'English',
    vocabulary = [], notes = ''
  } = options

  let content = []

  for (let i = 0; i < scans.length; ++i) {
    content.push({ type: 'text', text: `Page ${offset + i + 1}` })
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: scans[i].type,
        data: scans[i].data
      }
    })
  }

  content.push({
    type: 'text',
    text: `These are pages ${offset + 1} to ${offset + scans.length}. ` +
      'Report the documents.'
  })

  return {
    model,
    // Room to think. Thinking is on by default on Opus 5 and its tokens count
    // against this budget, so a tight ceiling truncates the manifest rather
    // than the reasoning. Streaming is what makes a budget this large safe.
    max_tokens: 64000,
    system: system(language, vocabulary, notes),
    messages: [{ role: 'user', content }],
    output_config: {
      effort,
      format: { type: 'json_schema', schema: SCHEMA }
    },
    first: offset + 1,
    last: offset + scans.length
  }
}

// Exact input tokens for a request that has not been sent yet. Counting is a
// separate endpoint and is not billed as inference, so the estimate shown
// before a run costs nothing to produce.
export async function countInput(client, request) {
  let { first, last, max_tokens, output_config, ...rest } = request

  try {
    let { input_tokens } = await client.messages.countTokens(rest)
    return input_tokens
  } catch {
    // An estimate is a courtesy; never let it stop the run.
    return null
  }
}

export async function segment(client, request, logger) {
  let { first, last, ...params } = request

  let stream = client.messages.stream(params)
  let message = await stream.finalMessage()

  let usage = {
    input: message.usage?.input_tokens ?? 0,
    output: message.usage?.output_tokens ?? 0
  }

  logger?.info({
    stop: message.stop_reason,
    blocks: message.content.map(b => b.type).join(','),
    ...usage
  }, `pass over pages ${first}-${last} returned`)

  if (message.stop_reason === 'refusal')
    throw new Error(
      `the model declined to segment this window (${
        message.stop_details?.category ?? 'no category'})`)

  if (message.stop_reason === 'max_tokens')
    throw new Error(
      'the model ran out of room before finishing the manifest — try a ' +
      'smaller window, or a lower effort setting')

  let text = message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')

  let manifest

  try {
    manifest = JSON.parse(text)
  } catch (err) {
    logger?.error({ text: text.slice(0, 2000) }, 'unparseable response')
    throw new Error(`could not parse the model's response: ${err.message}`)
  }

  // An empty pass is the one failure that says nothing about itself, so keep
  // enough of the response to tell a model that found nothing from a schema
  // or plumbing problem on the next run.
  if (!Array.isArray(manifest.documents) || manifest.documents.length === 0) {
    logger?.warn({
      keys: Object.keys(manifest).join(','),
      text: text.slice(0, 2000)
    }, `pass over pages ${first}-${last} found no documents`)
  }

  return { manifest, usage }
}
