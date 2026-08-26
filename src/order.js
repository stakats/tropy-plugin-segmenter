// How the pages came to be in this order.
//
// For a selection of several items the sequence is the list's own order, which
// is whatever column the list is sorted by. That is worth telling the user
// before they spend anything: sorting by Position or by filename usually means
// capture order, and sorting by Creator almost certainly does not.

import { dirname } from 'node:path'

// Tropy's own columns are property URIs; a few are reserved ids.
const COLUMNS = {
  'http://purl.org/dc/elements/1.1/title': 'Title',
  'http://purl.org/dc/elements/1.1/creator': 'Creator',
  'http://purl.org/dc/elements/1.1/date': 'Date',
  'http://purl.org/dc/elements/1.1/type': 'Type',
  'item.created': 'Date Added',
  'item.modified': 'Modified',
  'item.template': 'Template',
  added: 'Position'
}

export function sortColumn(state) {
  let sort = state?.nav?.sort?.[state?.nav?.list || 0]

  if (!sort?.column) return null

  return COLUMNS[sort.column] ??
    // A user-added metadata column: the last path segment is the closest
    // thing to a name we have without the ontology.
    sort.column.split(/[/#]/).filter(Boolean).pop() ??
    sort.column
}

// The directories the files sit in. In a managed project every photo lives in
// the project's own store, so this collapses to one and says nothing — which
// is the correct answer there rather than a special case.
export function folders(photos) {
  return [...new Set(
    photos
      .filter(p => (p?.protocol ?? 'file') === 'file' && p?.path)
      .map(p => dirname(p.path))
  )]
}
