import Anthropic from '@anthropic-ai/sdk'
import { seamLabel, seamsIn } from './seams.js'

// Building and sending one request. The prompt itself is assembled in
// `prompt.js`, which is where the policies are inlined; this file takes the
// system text as a string so that it holds no policy of its own and can be
// tested without a build.

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
      description:
        'pages to leave exactly where they are: covers, labels, rulers and ' +
        'color targets, and pages from a group that has nothing to do with ' +
        'the rest of the selection'
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
    model = 'claude-opus-5', effort = 'high', system = '', titles, sizes
  } = options

  let content = []
  let seams = seamsIn(scans, sizes)

  if (seams.size > 0)
    content.push({
      type: 'text',
      text: 'Some of these pages were gathered separately from the others. ' +
        'Where that is so, the join is marked between the pages.'
    })

  for (let i = 0; i < scans.length; ++i) {
    // A marker sits between two pages and takes no page number of its own.
    if (seams.has(i))
      content.push({
        type: 'text',
        text: seamLabel(scans[i - 1], scans[i], { titles, sizes })
      })

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
    system,
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
