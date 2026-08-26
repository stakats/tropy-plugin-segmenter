// What this project already calls things.
//
// `dc:type` is a classification the cataloguer assigns, not something read off
// the page, so it should follow the conventions of the project it is being
// added to rather than the language of the document. Tropy loads every item's
// metadata when a project opens (`sagas/project.js` dispatches
// `metadata.load()` with no argument), so the store holds the whole
// vocabulary, not just what is on screen.

const DC_TYPE = 'http://purl.org/dc/elements/1.1/type'

// Returns `[{ term, count }]`, commonest first. The counts matter as much as
// the terms: a project that has used one word a thousand times and another
// twice has a convention and a footnote, and a bare list makes them look
// equally established.
export function typeVocabulary(state, { limit = 12, min = 1 } = {}) {
  let counts = new Map()

  for (let id in state?.metadata ?? {}) {
    let value = state.metadata[id]?.[DC_TYPE]?.text

    if (typeof value !== 'string') continue

    let term = value.trim()
    if (!term) continue

    counts.set(term, (counts.get(term) ?? 0) + 1)
  }

  return [...counts]
    .filter(([, n]) => n >= min)
    // Commonest first, so a term used a thousand times outranks a one-off,
    // and ties break alphabetically rather than by insertion order.
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }))
}
