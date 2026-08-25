// The manifest is the interface between the judgment and the mechanics: the
// model produces it, and everything below this line is ordinary data handling
// that can be read, tested and corrected without a model in the loop.

// Reconcile the windows into one manifest.
//
// Windows overlap so that a document straddling a window edge is seen whole by
// the later window. When a document from a later window overlaps documents
// already accepted, the later reading replaces them: it is the one that saw
// the whole run.
export function reconcile(results) {
  let documents = []
  let unassigned = new Set()
  let openAtEnd = false

  for (let result of results) {
    for (let doc of result.documents) {
      if (!(doc.last >= doc.first)) continue

      while (documents.length > 0 &&
        documents[documents.length - 1].last >= doc.first) {
        documents.pop()
      }

      documents.push(doc)
    }

    for (let page of result.unassigned ?? []) unassigned.add(page)
    openAtEnd = Boolean(result.openAtEnd)
  }

  // A page can be called a cover by one window and part of a document by the
  // next; the document wins.
  for (let doc of documents) {
    for (let page = doc.first; page <= doc.last; ++page) unassigned.delete(page)
  }

  return {
    documents,
    unassigned: [...unassigned].sort((a, b) => a - b),
    openAtEnd
  }
}

// Turn the manifest's page numbers into photo ids, and check that every page
// the model named actually exists and belongs to the item.
export function resolve(manifest, photoIds) {
  let documents = []

  for (let doc of manifest.documents) {
    let photos = []

    for (let page = doc.first; page <= doc.last; ++page) {
      let id = photoIds[page - 1]

      if (id == null)
        throw new Error(
          `the manifest names page ${page}, but this item has ` +
          `${photoIds.length} photos`)

      photos.push(id)
    }

    if (photos.length > 0) documents.push({ ...doc, photos })
  }

  let seen = new Set()

  for (let doc of documents) {
    for (let id of doc.photos) {
      if (seen.has(id))
        throw new Error(`photo ${id} is assigned to more than one document`)
      seen.add(id)
    }
  }

  return documents
}
