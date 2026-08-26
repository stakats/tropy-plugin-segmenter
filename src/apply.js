import { dispatchAndWait } from './store.js'
import { provenanceNote } from './provenance.js'
import {
  explode, merge, addTag, createNote, saveMetadata,
  PROPERTIES, DATE_TYPE, TEXT_TYPE
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

  return data
}



// Get every photo onto an item of its own, then merge each document's photos
// back together.
//
// Both shapes of input reduce to the same thing. One item holding a dossier is
// exploded first; a pile of separately imported scans is *already* in the
// exploded state, one photo per item, and needs no exploding at all. What is
// left in either case is a merge per document.
//
// Photos are reassigned, never duplicated, and any item that is split survives
// as a shell holding whatever it recorded. Both commands register undo.
export async function apply(store, options) {
  let {
    items: sources, documents, reviewTag, lowConfidenceTag, provenance,
    logger, onProgress, timeout = 15000
  } = options

  let assigned = documents.flatMap(doc => doc.photos)

  if (assigned.length === 0)
    throw new Error('the manifest assigns no photos to any document')

  let state = store.getState()
  let owners = new Set(sources)

  for (let id of assigned) {
    let owner = state.photos[id]?.item

    if (!owners.has(owner))
      throw new Error(
        `photo ${id} belongs to item ${owner}, which is not in the selection`)
  }

  // A photo already alone on its item needs no exploding — that is the whole
  // difference between the two shapes of input.
  let toExplode = sources
    .map(id => [id, state.items[id].photos.filter(p => assigned.includes(p))])
    .filter(([id, photos]) =>
      photos.length > 0 && state.items[id].photos.length > 1)

  if (toExplode.length > 0)
    logger?.info(
      `exploding ${toExplode.reduce((n, [, p]) => n + p.length, 0)} photos ` +
      `out of ${toExplode.length} item(s)`)
  else
    logger?.info(`${assigned.length} photos are already one to an item`)

  for (let [id, photos] of toExplode) {
    await dispatchAndWait(
      store,
      explode({ id, photos }),
      (s) => photos.every(p =>
        s.photos[p]?.item != null && s.photos[p].item !== id),
      { label: `explode item ${id}` })
  }

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

  logger?.info(`gathered ${created.length} document-level items`)

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

  // Every item gets a note, whether or not there is a remark to make: until
  // Tropy can record that a value came from a model, the note is the only
  // place that fact lives. Notes go on the photo each document opens with,
  // since notes belong to photos rather than items. Re-running accumulates
  // rather than replaces — overwriting provenance is the wrong instinct.
  let notes = 0

  for (let i = 0; i < documents.length; ++i) {
    let doc = documents[i]
    let html = provenance && provenanceNote(doc, {
      ...provenance,
      source: provenance.sourceOf(doc),
      pages: doc.first === doc.last ?
        `${doc.first}` : `${doc.first}-${doc.last}`
    })

    if (!html) continue

    let photo = doc.photos[0]
    let before = store.getState().photos[photo]?.notes?.length ?? 0

    try {
      await dispatchAndWait(
        store,
        createNote({ photo, text: html }),
        (s) => (s.photos[photo]?.notes?.length ?? 0) > before,
        { label: `note on photo ${photo}`, timeout })

      notes += 1

    } catch (err) {
      logger?.warn({ err }, `could not add a note to photo ${photo}`)
      warnings.push(`no note on item ${created[i]}: ${err.message}`)
    }
  }

  // Everything gets the review tag, so the review tag cannot tell you where to
  // look. This one can.
  if (lowConfidenceTag) {
    let uncertain = created.filter((id, i) =>
      documents[i].confidence && documents[i].confidence !== 'high')

    if (uncertain.length > 0) {
      try {
        await tag(store, uncertain, lowConfidenceTag, timeout)
      } catch (err) {
        logger?.warn({ err }, 'could not tag the uncertain items')
        warnings.push(`not tagged "${lowConfidenceTag}": ${err.message}`)
      }
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

  return { items: created, notes, warnings }
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
