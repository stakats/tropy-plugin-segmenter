import { DEFAULTS } from 'virtual:policy'
import { getStore, getPhotoSequence, getSelection } from './store.js'
import { assertDistinct, planWindows, renderScans } from './scan.js'
import { countInput, createClient, requestFor, segment } from './model.js'
import { verify } from './verify.js'
import { languageName } from './locale.js'
import { describe, rateFor } from './cost.js'
import { typeVocabulary } from './vocabulary.js'
import { readCollectionNotes } from './collection.js'
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
  let out = { model: 'claude-opus-5', effort: 'high', dryRun: false }

  for (let [option, setting] of Object.entries(FROM_SETTINGS)) {
    if (DEFAULTS[setting] != null) out[option] = DEFAULTS[setting]
  }

  return out
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
        input: this.options.inputRate,
        output: this.options.outputRate
      })

      // Rendering is local and free, and it is what makes the estimate exact
      // rather than a guess, so it happens before the user is asked to commit.
      let vocabulary = typeVocabulary(state)

      if (vocabulary.length > 0)
        logger?.info(`document types already in this project: ${
          vocabulary.map(({ term, count }) => `${term} (${count})`).join(', ')}`)

      let notes = await readCollectionNotes(
        this.options.collectionNotes, { logger })

      let requests = await this.prepare(
        photos, { logger, sharp, language, vocabulary, notes })
      let input = await this.price(client, requests, logger)

      // Thinking is billed as output and scales with effort, so this is the
      // one part that stays a guess. Measured at roughly 130 output tokens
      // per page on a 24-page dossier at high effort.
      let output = photoIds.length * 200

      let cost = (input == null) ?
        'not known until it runs' :
        describe({ input, output, rate, estimated: true })

      let go = await dialog.show('message-box', {
        type: 'question',
        buttons: ['Cancel', 'Segment'],
        defaultId: 1,
        cancelId: 0,
        message: (selection.length === 1) ?
          'Segment this item?' :
          `Segment these ${selection.length} items?`,
        detail: `${photoIds.length} photos go to ${model.display_name} to ` +
          `find document boundaries.\n\nEstimated cost: ${cost}\nBilled to ` +
          'your Anthropic API key.'
      })

      if (go.response !== 1) return

      let { manifest, usage } = await this.run(requests, client, logger)

      logger?.info(`actual cost ${describe({ ...usage, rate })}`)

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
        logger
      })

      logger?.info(
        `${selection.length} item(s) became ${result.items.length}`)
      await this.report(dialog, documents, manifest, {
        ...result, cost: describe({ ...usage, rate })
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

  // Render the scans and build one request per pass. Nothing is sent.
  async prepare(photos, { logger, sharp, language, vocabulary, notes }) {
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

    return windows.map(({ start, end }) =>
      requestFor(scans.slice(start, end), start,
        { model, effort, language, vocabulary, notes }))
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

  report(dialog, documents, manifest, {
    items, warnings = [], dryRun, cost
  } = {}) {
    let low = documents.filter(d => d.confidence === 'low')
    let notes = documents.filter(d => d.note)

    let detail = [
      `${documents.length} documents`,
      manifest.unassigned.length > 0 ?
        `${manifest.unassigned.length} pages left unassigned (covers, labels)` :
        null,
      low.length > 0 ? `${low.length} at low confidence` : null,
      manifest.openAtEnd ?
        'the last document is still open at the final photo' : null,
      cost ? `\nActual cost: ${cost}` : null,
      notes.length > 0 ?
        `\nNotes:\n${notes.map(d => `• p${d.first}: ${d.note}`).join('\n')}` :
        null,
      warnings.length > 0 ?
        `\nThe segmentation itself is complete, but:\n${
          warnings.map(w => `• ${w}`).join('\n')}` :
        null
    ].filter(Boolean).join('\n')

    return dialog.show('message-box', {
      type: 'info',
      message: dryRun ?
        'Segmentation plan (nothing was changed)' :
        `${items.length} documents`,
      detail
    })
  }
}
