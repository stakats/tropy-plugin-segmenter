import { dispatchAndWait } from './store.js'
import {
  explode, merge, addTag, saveMetadata, PROPERTIES, DATE_TYPE, TEXT_TYPE
} from './constants.js'

const TAG_CREATE = 'tag.create'

function metadataFor(doc) {
  let data = {}
  let text = (value) => ({ text: value, type: TEXT_TYPE })

  if (doc.title) data[PROPERTIES.title] = text(doc.title)
  if (doc.type) data[PROPERTIES.type] = text(doc.type)
  if (doc.creator) data[PROPERTIES.creator] = text(doc.creator)
  if (doc.recipient) data[PROPERTIES.recipient] = text(doc.recipient)
  if (doc.date) data[PROPERTIES.date] = { text: doc.date, type: DATE_TYPE }

  let note = [
    doc.confidence ? `confidence: ${doc.confidence}` : null,
    doc.note || null
  ].filter(Boolean).join(' — ')

  if (note) data[PROPERTIES.description] = text(note)

  return data
}

// Explode every assigned photo out of the batch item, then merge each
// document's photos back together. Photos are reassigned, never duplicated,
// and the batch item survives as an empty dossier shell holding the
// dossier-level record. Both commands register their own undo entry.
export async function apply(store, options) {
  let {
    batchId, documents, reviewTag, logger, onProgress, timeout = 15000
  } = options

  let assigned = documents.flatMap(doc => doc.photos)

  if (assigned.length === 0)
    throw new Error('the manifest assigns no photos to any document')

  let state = store.getState()

  for (let id of assigned) {
    if (state.photos[id]?.item !== batchId)
      throw new Error(`photo ${id} does not belong to item ${batchId}`)
  }

  logger?.info(
    `exploding ${assigned.length} photos out of item ${batchId}`)

  await dispatchAndWait(
    store,
    explode({ id: batchId, photos: assigned }),
    (s) => assigned.every(id =>
      s.photos[id]?.item != null && s.photos[id].item !== batchId),
    { label: 'explode' })

  state = store.getState()

  let itemFor = new Map(
    assigned.map(id => [id, state.photos[id].item]))

  let created = []

  for (let i = 0; i < documents.length; ++i) {
    let doc = documents[i]
    let items = doc.photos.map(id => itemFor.get(id))
    let target = items[0]

    if (items.length > 1) {
      await dispatchAndWait(
        store,
        merge(items),
        (s) => s.items[target]?.photos?.length === doc.photos.length,
        { label: `merge document ${i + 1}` })
    }

    created.push(target)
    onProgress?.(i + 1, documents.length)
  }

  logger?.info(`created ${created.length} document-level items`)

  // The photos are already where they belong, and that is the part that is
  // hard to redo by hand. Metadata and tags are worth reporting when they
  // fail, but not worth discarding a correct split for.
  let warnings = []

  for (let i = 0; i < documents.length; ++i) {
    let id = created[i]
    let data = metadataFor(documents[i])

    if (Object.keys(data).length === 0) continue

    try {
      await dispatchAndWait(
        store,
        saveMetadata({ id, data }),
        (s) => {
          let m = s.metadata[id]
          return m != null && Object.keys(data)
            .every(uri => m[uri]?.text === data[uri].text)
        },
        { label: `metadata for item ${id}`, timeout })

    } catch (err) {
      logger?.warn({ err }, `could not write metadata for item ${id}`)
      warnings.push(`no metadata on item ${id}: ${err.message}`)
    }
  }

  // `metadata.save` updates state before it writes to the database and rolls
  // state back if the write fails, so a predicate over state can go green on a
  // write that never lands. Re-read once everything has settled.
  let settled = store.getState()

  for (let i = 0; i < documents.length; ++i) {
    let id = created[i]
    let data = metadataFor(documents[i])
    let saved = settled.metadata[id] ?? {}

    let missing = Object.keys(data)
      .filter(uri => saved[uri]?.text !== data[uri].text)

    if (missing.length > 0 && !warnings.some(w => w.includes(`item ${id}`))) {
      logger?.warn({ missing }, `metadata did not stick on item ${id}`)
      warnings.push(
        `metadata did not save on item ${id} — see the Tropy log for why`)
    }
  }

  if (reviewTag) {
    try {
      await tag(store, created, reviewTag, timeout)
    } catch (err) {
      logger?.warn({ err }, 'could not tag the new items')
      warnings.push(`not tagged "${reviewTag}": ${err.message}`)
    }
  }

  return { items: created, warnings }
}

// `item.tag.create` resolves tag names but does not create missing tags, and
// `tag.create` with `meta.resolve` returns an existing tag *without* attaching
// it to the items. So the two cases have to be told apart here.
async function tag(store, items, name, timeout) {
  let state = store.getState()
  let existing = findTagByName(state, name)

  let action = (existing == null) ?
    { type: TAG_CREATE, payload: { name, items }, meta: { cmd: 'project', history: 'add' } } :
    addTag({ id: items, tags: [name] })

  if (existing != null) action.meta.resolve = true

  await dispatchAndWait(
    store,
    action,
    (s) => {
      let id = findTagByName(s, name)
      return id != null && items.every(item => s.items[item]?.tags?.includes(id))
    },
    { label: `tag "${name}"`, timeout })
}

function findTagByName(state, name) {
  for (let id in state.tags) {
    if (state.tags[id].name === name) return Number(id)
  }
  return null
}
