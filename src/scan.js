// Pass-1 images. `context.sharp` is Tropy's own sharp wrapper
// (`src/image/sharp.js`), so the downscale happens in process, straight from
// the photo's path — no render endpoint, and nothing depending on Tropy having
// been granted permission to read the folder through a second process.

// Cheap non-cryptographic hash, only ever used to notice that two renders came
// out byte-identical.
function fingerprint(data) {
  let h = 0x811c9dc5

  for (let i = 0; i < data.length; ++i) {
    h ^= data.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }

  return h.toString(16)
}

export async function renderScan(sharp, photo, edge) {
  if (photo.protocol && photo.protocol !== 'file')
    throw new Error(
      `photo ${photo.id} is not a local file (protocol "${photo.protocol}")`)

  // A PDF or multi-page TIFF puts every page behind the *same* path and tells
  // them apart with `page`. Without this, a 24-page PDF renders as 24 copies
  // of page one.
  let options = {}

  if (photo.page > 0) options.page = photo.page
  if (photo.density > 0) options.density = photo.density

  let image = await sharp.open(photo.path, options)

  let buffer = await image
    .rotate() // honour EXIF orientation before resizing
    .resize({
      width: edge,
      height: edge,
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: 80 })
    .toBuffer()

  let data = buffer.toString('base64')

  return {
    id: photo.id,
    page: photo.page,
    item: photo.item,
    path: photo.path,
    data,
    bytes: buffer.length,
    hash: fingerprint(data),
    type: 'image/jpeg'
  }
}

export async function renderScans(sharp, photos, edge, onProgress) {
  let scans = []

  // Serial on purpose: sharp already runs its own thread pool, and a dossier
  // of sixty full-resolution scans decoded at once is a memory spike inside
  // the app's own renderer process.
  for (let photo of photos) {
    scans.push(await renderScan(sharp, photo, edge))
    if (onProgress) onProgress(scans.length, photos.length)
  }

  return scans
}

// Renders that all came out identical mean the pages never reached the model,
// not that the dossier holds one document. Worth failing on: the model would
// otherwise answer a question it was never really asked, and bill for it.
//
// Only a *total* collapse is unambiguous. Partial duplication is normal —
// blank versos are part of the material, and near-identical frames are what a
// microfilm surrogate looks like — so it is reported, never rejected.
export function assertDistinct(scans) {
  if (scans.length < 2) return 0

  let hashes = new Set(scans.map(s => s.hash))

  if (hashes.size === 1)
    throw new Error(
      `all ${scans.length} pages rendered to the same image — the photos are ` +
      'probably pages of one file that are not being told apart')

  return scans.length - hashes.size
}

// Split a long dossier into overlapping passes, so a document straddling a
// window edge is still seen whole by at least one pass.
export function planWindows(count, size, overlap) {
  if (!(size > 0)) throw new Error('window size must be positive')
  if (count <= size) return [{ start: 0, end: count }]

  let step = Math.max(1, size - Math.max(0, overlap))
  let windows = []

  for (let start = 0; start < count; start += step) {
    let end = Math.min(start + size, count)
    windows.push({ start, end })
    if (end === count) break
  }

  return windows
}
