import { DEFAULTS, DIGESTS, PRICING, VERSION } from 'virtual:policy'
import { getStore, getPhotoSequence, getSelection } from './store.js'
import { assertDistinct, planWindows, renderScans } from './scan.js'
import { countInput, createClient, requestFor, segment } from './model.js'
import { system } from './prompt.js'
import { verify } from './verify.js'
import { languageName } from './locale.js'
import { describe, rateFor } from './cost.js'
import { typeVocabulary } from './vocabulary.js'
import { readCollectionNotes } from './collection.js'
import { MARKER } from './provenance.js'
import { folders, sortColumn } from './order.js'
import { reconcile, resolve } from './manifest.js'
import { apply } from './apply.js'

// segmentation.json is written for the humans revising the policy, so its keys
// are snake_case; the plugin options are camelCase because Tropy renders them.
const FROM_SETTINGS = {
  scanEdge: 'scan_edge',
  window: 'window',
  overlap: 'overlap',
  reviewTag: 'review_tag'
}

function defaults() {
  let out = {
    model: 'claude-opus-5',
    effort: 'high',
    dryRun: false,
    lowConfidenceTag: 'low confidence'
  }

  for (let [option, setting] of Object.entries(FROM_SETTINGS)) {
    if (DEFAULTS[setting] != null) out[option] = DEFAULTS[setting]
  }

  return out
}

// Short, sortable, and enough to group one run's items together without
// pretending to be a UUID.
function runId() {
  return Math.random().toString(16).slice(2, 10)
}

function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
}

export default class SegmenterPlugin {

  constructor(options, context) {
    this.options = { ...defaults(), ...options }
    this.context = context
  }

  // Tropy has no "segment" hook, so this hangs off `export`, which is where
  // plugins appear in the item context menu. The payload Tropy passes carries
  // no item or photo ids — see PLUGIN-PORT.md — so it is ignored, and the
  // selection is read from the store instead.
  async export() {
    let { dialog, logger, sharp } = this.context

    try {
      let store = getStore(this.context)
      let state = store.getState()

      let selection = getSelection(state)

      if (selection.length === 0)
        throw new Error('select the items to segment first')

      // One item holding a dossier, or a pile of separately imported scans —
      // both are just a sequence of photos to read in order.
      let photoIds = getPhotoSequence(state, selection)

      if (photoIds.length < 2)
        throw new Error(
          'there are fewer than two photos in the selection, nothing to ' +
          'segment')

      let photos = photoIds.map(id => state.photos[id])

      if (photos.some(p => p == null))
        throw new Error('some of the selected photos are not loaded yet')

      logger?.info(
        `segmenting ${photoIds.length} photos across ${selection.length} item(s)`)

      // The key and the model are free-text fields, so they are checked
      // before anything is rendered and before the user is asked to commit.
      let client = createClient(this.options.apiKey)
      let model = await verify(client, this.options.model)

      logger?.info(`using ${model.display_name} (${model.id})`)

      let language = languageName(state.intl?.locale)
      let rate = rateFor(model.id, {
        rates: PRICING.rates,
        overrides: {
          input: this.options.inputRate,
          output: this.options.outputRate
        }
      })

      // Rendering is local and free, and it is what makes the estimate exact
      // rather than a guess, so it happens before the user is asked to commit.
      let titles = new Map(selection.map(id => [
        id,
        state.metadata[id]?.['http://purl.org/dc/elements/1.1/title']?.text
      ]))
      let sizes = new Map(selection.map(id => [
        id, state.items[id]?.photos?.length ?? 0
      ]))

      let shape = {
        titles,
        sizes,
        order: sortColumn(state),
        folders: folders(photos)
      }

      let vocabulary = typeVocabulary(state)

      if (vocabulary.length > 0)
        logger?.info(`document types already in this project: ${
          vocabulary.map(({ term, count }) => `${term} (${count})`).join(', ')}`)

      let collection = await readCollectionNotes(
        this.options.collectionNotes, { logger })

      let requests = await this.prepare(photos, {
        logger, sharp, language, vocabulary, notes: collection.text,
        titles, sizes
      })
      let input = await this.price(client, requests, logger)

      // Thinking is billed as output and scales with effort, so this is the
      // one part that stays a guess. Measured at roughly 130 output tokens
      // per page on a 24-page dossier at high effort.
      let output = photoIds.length * 200

      let cost = (input == null) ?
        'not known until it runs' :
        describe({
          input, output, rate, estimated: true, pricedOn: PRICING.updated
        })

      let go = await dialog.show('message-box', {
        type: 'question',
        buttons: ['Cancel', 'Segment'],
        defaultId: 1,
        cancelId: 0,
        message: (selection.length === 1) ?
          'Segment this item?' :
          `Segment these ${selection.length} items?`,
        detail: [
          this.describeSelection(selection, photoIds, shape, model),
          '',
          `Estimated cost: ${cost}`,
          'Billed to your Anthropic API key.'
        ].join('\n')
      })

      if (go.response !== 1) return

      let { manifest, usage } = await this.run(requests, client, logger)

      logger?.info(`actual cost ${describe({ ...usage, rate, pricedOn: PRICING.updated })}`)

      let documents = resolve(manifest, photoIds)

      if (documents.length === 0)
        throw new Error('no documents were found in this item')

      if (this.options.dryRun) {
        await this.report(dialog, documents, manifest, { dryRun: true })
        return
      }

      let result = await apply(store, {
        items: selection,
        documents,
        reviewTag: this.options.reviewTag,
        lowConfidenceTag: this.options.lowConfidenceTag,
        provenance: this.provenance(
          state, selection, model, collection, shape),
        logger
      })

      logger?.info(
        `${selection.length} item(s) became ${result.items.length}`)
      await this.report(dialog, documents, manifest, {
        ...result, cost: describe({ ...usage, rate, pricedOn: PRICING.updated })
      })

    } catch (err) {
      logger?.error({ stack: err.stack }, `segmenter: ${err.message}`)
      await dialog.show('message-box', {
        type: 'error',
        message: 'Could not segment this item',
        detail: err.message
      })
    }
  }

  // What is about to happen, in enough detail to decide against it. This is
  // the last point at which the selection or the sort can be changed, and the
  // order the pages will be read in is not otherwise visible anywhere.
  describeSelection(selection, photoIds, shape, model) {
    let single = selection.length === 1
    let allSingle = [...shape.sizes.values()].every(n => n === 1)

    let what = single ?
      `${photoIds.length} photos` :
      allSingle ?
        `${photoIds.length} scans, one photo each` :
        `${photoIds.length} photos from ${selection.length} items`

    let order = single ?
      'in the order they sit in the item' :
      shape.order ?
        `in the order the list shows them, sorted by ${shape.order}` :
        'in the order the list shows them'

    return [
      `${what} go to ${model.display_name} to find document boundaries, ` +
      `${order}.`,
      // Only worth saying when it can distinguish anything: a managed project
      // keeps every photo in one store, so this stays silent there.
      shape.folders.length > 1 ?
        `They are drawn from ${shape.folders.length} different folders.` :
        null
    ].filter(Boolean).join('\n')
  }

  // Everything an item's note has to say about how it came to exist. Gathered
  // once per run so that every item records the same run, and so that what is
  // being written down is legible in one place.
  provenance(state, selection, model, collection, shape) {
    let allSingle = [...shape.sizes.values()].every(n => n === 1)
    let photoItem = new Map()

    for (let id of selection) {
      for (let photo of state.items[id]?.photos ?? []) photoItem.set(photo, id)
    }

    return {
      marker: MARKER,
      plugin: VERSION,
      model: model.id,
      effort: this.options.effort,
      scanEdge: this.options.scanEdge,
      digests: DIGESTS,
      collection: collection.source,
      runId: runId(),
      at: timestamp(),

      selection: (selection.length === 1) ? null :
        allSingle ?
          `${selection.length} single-photo items` :
          `${selection.length} items`,

      order: (selection.length === 1) ? null :
        shape.order ?
          `list order, sorted by ${shape.order}` :
          'list order',

      // Which items a document's pages were drawn from, and whether any of
      // them was a grouping somebody had already made.
      sourcesOf: (doc) => [...new Set(doc.photos.map(p => photoItem.get(p)))]
        .filter(id => id != null)
        .map(id => ({
          id,
          title: shape.titles.get(id),
          grouped: (shape.sizes.get(id) ?? 1) > 1
        }))
    }
  }

  // Render the scans and build one request per pass. Nothing is sent.
  async prepare(photos, {
    logger, sharp, language, vocabulary, notes, titles, sizes
  }) {
    let { scanEdge, window, overlap, model, effort } = this.options

    let scans = await renderScans(sharp, photos, scanEdge, (done, total) => {
      if (done === total || done % 10 === 0)
        logger?.info(`rendered ${done}/${total} scans at ${scanEdge}px`)
    })

    logger?.info({
      distinct: new Set(scans.map(s => s.hash)).size,
      pages: scans.map(s => s.page).join(','),
      bytes: scans.map(s => s.bytes).join(',')
    }, `rendered ${scans.length} scans`)

    let duplicates = assertDistinct(scans)

    if (duplicates > 0)
      logger?.warn(`${duplicates} of ${scans.length} pages rendered identically`)

    let windows = planWindows(scans.length, window, overlap)

    logger?.info(
      `segmenting ${scans.length} photos in ${windows.length} pass(es), ` +
      `reporting in ${language}`)

    let prompt = system(language, vocabulary, notes)

    return windows.map(({ start, end }) =>
      requestFor(scans.slice(start, end), start,
        { model, effort, system: prompt, titles, sizes }))
  }

  // Exact input tokens across every pass, before any of them is sent.
  async price(client, requests, logger) {
    let total = 0

    for (let request of requests) {
      let input = await countInput(client, request)

      if (input == null) {
        logger?.warn('could not count tokens; running without an estimate')
        return null
      }

      total += input
    }

    return total
  }

  async run(requests, client, logger) {
    let results = []
    let usage = { input: 0, output: 0 }

    // Serial, because each window's reading of the overlap depends on how the
    // previous window ended. Windows are independent enough to parallelize —
    // see NOTES.md — but that is a change to the policy, not to the plumbing.
    for (let request of requests) {
      let pass = await segment(client, request, logger)

      results.push(pass.manifest)
      usage.input += pass.usage.input
      usage.output += pass.usage.output
    }

    let manifest = reconcile(results)

    logger?.info(
      `manifest: ${manifest.documents.length} documents, ` +
      `${manifest.unassigned.length} unassigned, ` +
      `openAtEnd=${manifest.openAtEnd}`)

    return { manifest, usage }
  }

  // A summary, deliberately. An earlier version listed every document's note
  // here, and on a dossier of seventeen the dialog grew past the screen and
  // took its own OK button with it. The notes now live on the items, where
  // they can be read at leisure; this says what happened and where to look.
  report(dialog, documents, manifest, {
    items, notes = 0, warnings = [], dryRun, cost
  } = {}) {
    let uncertain = documents.filter(
      d => d.confidence && d.confidence !== 'high').length

    let lines = [
      `${documents.length} documents from ${
        manifest.unassigned.length + documents.reduce(
          (n, d) => n + d.photos.length, 0)} photos`,
      manifest.unassigned.length > 0 ?
        `${manifest.unassigned.length} left unassigned — covers, labels, targets` :
        null,
      uncertain > 0 ?
        `${uncertain} uncertain, tagged "${this.options.lowConfidenceTag}"` :
        null,
      (!dryRun && notes > 0) ?
        `${notes} notes attached, on the first photo of each` :
        null,
      manifest.openAtEnd ?
        'The last document is still open at the final photo — it runs past ' +
        'the end of what was selected.' :
        null,
      cost ? `\nActual cost: ${cost}` : null
    ].filter(Boolean)

    if (warnings.length > 0) {
      // Truncated, for the same reason the notes are not listed.
      let shown = warnings.slice(0, 5)

      lines.push(
        `\nThe segmentation is complete, but:\n${
          shown.map(w => `• ${w}`).join('\n')}${
          warnings.length > shown.length ?
            `\n• and ${warnings.length - shown.length} more, in the log` : ''}`)
    }

    return dialog.show('message-box', {
      type: 'info',
      message: dryRun ?
        `${documents.length} documents found (nothing was changed)` :
        `Segmented into ${items.length} items`,
      detail: lines.join('\n')
    })
  }
}
