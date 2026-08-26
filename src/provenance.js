// The provenance note.
//
// A stand-in, until Tropy has somewhere real to record that a value came from
// a model rather than from a person. Until then the note is the only place
// that fact can live, so it is written on every item the plugin creates,
// whether or not there is anything else to say about it.
//
// Three properties it needs to keep:
//
//   Self-contained. It cannot point at a run record held elsewhere: a source
//   item that gave up all of its photos has none left to hold a note, and an
//   item exported on its own must still carry its own provenance.
//
//   Parseable. When there is a real data layer, these notes are what has to be
//   migrated into it, so the marker and the labels are fixed strings and the
//   labels stay in English whatever language the remark is in.
//
//   Honest about what was seen. The scan size matters more than anything else
//   here: a date misread from a 1024px copy is a different kind of error from
//   one misread at full resolution, and nothing else in Tropy records it.

// Bumped only if the shape below changes in a way a parser would care about.
export const MARKER = 'tropy-segment/1'

// Notes written before the plugin was renamed carry `tropy-segmenter/1`. The
// shape is identical; anything migrating these notes into a real provenance
// layer has to accept both.
export const MARKERS = ['tropy-segment/1', 'tropy-segmenter/1']

const escape = (value) => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

function assembled(sources) {
  if (sources.length < 2) return null
  if (!sources.some(s => s.grouped)) return null

  return `pages from items ${sources.map(s => s.id).join(', ')}`
}

const field = (label, value) =>
  (value == null || value === '') ? null : `${label}: ${escape(value)}`

export function provenanceNote(doc, run) {
  let {
    plugin, model, effort, scanEdge, digests, collection, runId, at,
    source, sources = [], pages, order, selection
  } = run

  let paragraphs = []

  // The remark first: it is the only part that might need acting on.
  if (doc.note) paragraphs.push(`<p>${escape(doc.note)}</p>`)

  let where = [
    pages ? `Pages ${pages} of ${escape(source.title || `item ${source.id}`)}` :
      null,
    `judged from ${scanEdge} px copies by ${escape(model)}`
  ].filter(Boolean).join(', ')

  paragraphs.push(`<p>${where}.</p>`)

  let lines = [
    field('marker', MARKER),
    field('run', [runId, at].filter(Boolean).join(', ')),
    field('plugin', plugin),
    field('model', effort ? `${model}, effort ${effort}` : model),
    field('images', `${scanEdge} px longest edge`),
    field('source', `item ${source.id}${pages ? `, pages ${pages}` : ''}`),
    field('selection', selection),
    field('order', order),
    // Only where it says something. In the ordinary case of loose scans every
    // document is assembled from several items, which is the point of the run
    // rather than a thing to flag; what is worth recording is a document
    // carried across a grouping somebody had already made.
    field('assembled', assembled(sources)),
    field('confidence', doc.confidence),
    field('policy', digests ?
      `segmentation.md ${digests.segmentation}, metadata.md ${digests.metadata}` :
      null),
    field('collection notes', collection)
  ].filter(Boolean)

  // A blockquote, so the block reads as an aside rather than as something a
  // person typed. Headings and code blocks are not in Tropy's note schema
  // (src/editor/schema.js), so line breaks inside one quoted paragraph is as
  // structured as a note can get.
  paragraphs.push(`<blockquote><p>${lines.join('<br>')}</p></blockquote>`)

  return paragraphs.join('')
}
