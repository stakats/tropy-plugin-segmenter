// Where the pages either side came together by different routes.
//
// The unit is not the item. In the commonest Tropy project every item holds a
// single photo — forty scans dragged in at once are forty items — and marking
// every one of those joins would drown the sequence in noise and, worse, make
// discontinuity the default in exactly the workflow most people use.
//
// What matters is whether somebody gathered these pages separately. Two
// indications of that are available, and either is enough:
//
//   An item holding more than one photo is a grouping somebody made, so where
//   one begins or ends, something was decided.
//
//   Files in different directories came from different shoots, folders or
//   imports. In a managed project every photo lives in the project's own
//   store, so this collapses to one directory and contributes nothing — which
//   is the right answer there, and needs no special case.

import { dirname } from 'node:path'

const directory = (scan) =>
  scan?.path ? dirname(scan.path) : null

const name = (scan, titles) =>
  titles?.get(scan.item) || `item ${scan.item}`

// True when the pages either side of this pair were gathered separately.
export function isSeam(prev, next, sizes) {
  if (!prev || !next) return false
  if (prev.item === next.item) return false

  let grouped = (sizes?.get(prev.item) ?? 1) > 1 ||
    (sizes?.get(next.item) ?? 1) > 1

  return grouped || directory(prev) !== directory(next)
}

// What to say at one. Named so a reader can tell which join is which, and
// factual about what actually differs.
export function seamLabel(prev, next, { titles, sizes } = {}) {
  let parts = []

  if ((sizes?.get(prev.item) ?? 1) > 1 || (sizes?.get(next.item) ?? 1) > 1)
    parts.push(
      `${name(prev, titles)} ends here and ${name(next, titles)} begins`)

  if (directory(prev) !== directory(next))
    parts.push('the files come from different folders')

  return `— ${parts.join(', and ')} —`
}

// The indices a seam falls *before*, within one window of scans.
export function seamsIn(scans, sizes) {
  let at = new Set()

  for (let i = 1; i < scans.length; ++i) {
    if (isSeam(scans[i - 1], scans[i], sizes)) at.add(i)
  }

  return at
}
