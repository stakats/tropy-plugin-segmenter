// Tropy's action types and RDF properties. A plugin is bundled separately from
// the app, so it cannot import Tropy's own constants or action creators; the
// actions below are constructed by hand and must match `src/constants/` and
// `src/actions/` in the Tropy source.

export const ITEM = {
  EXPLODE: 'item.explode',
  MERGE: 'item.merge',
  TAG: {
    CREATE: 'item.tag.create'
  }
}

export const METADATA = {
  SAVE: 'metadata.save'
}

// Every command Tropy registers in its undo history carries this meta.
const CMD = { cmd: 'project', history: 'add', search: true }

export const explode = (payload) =>
  ({ type: ITEM.EXPLODE, payload, meta: { ...CMD } })

export const merge = (items) =>
  ({ type: ITEM.MERGE, payload: items, meta: { ...CMD } })

export const addTag = (payload) =>
  ({ type: ITEM.TAG.CREATE, payload, meta: { ...CMD } })

// Mirrors `act.metadata.save` in src/actions/metadata.js: the Save command
// destructures `{ ids, data }` and iterates ids, so a lone `id` has to be
// normalised into an array here. Passing `{ id }` writes nothing, silently.
export const saveMetadata = ({ id, ids, data }) =>
  ({
    type: METADATA.SAVE,
    payload: { ids: [].concat(ids ?? id), data },
    meta: { cmd: 'project', history: 'add' }
  })

const DC = 'http://purl.org/dc/elements/1.1/'
const DCTERMS = 'http://purl.org/dc/terms/'
const TROPY = 'https://tropy.org/v1/tropy#'

export const PROPERTIES = {
  title: DC + 'title',
  type: DC + 'type',
  creator: DC + 'creator',
  recipient: DCTERMS + 'audience',
  description: DC + 'description',
  // The *property* is dc:date, the same one the dossier and the templates
  // use, so a document's own date replaces the date it inherited. What makes
  // "1777-1778" or "an 11" parse is the *datatype* below — tropy#date is a
  // datatype, not a property, and writing it as a property puts the value
  // somewhere no template displays.
  date: DC + 'date'
}

// metadata_values.datatype is NOT NULL. Tropy fills it in only for values
// given as bare strings (src/commands/metadata/save.js), so an object value
// must carry its own type or SQLite rejects the write — after the optimistic
// state update has already made it look like it worked.
export const DATE_TYPE = TROPY + 'date'
export const TEXT_TYPE = 'http://www.w3.org/2001/XMLSchema#string'
