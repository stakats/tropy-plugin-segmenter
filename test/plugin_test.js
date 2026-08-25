import assert from 'node:assert'
import { assertDistinct, planWindows } from '../src/scan.js'
import { reconcile, resolve } from '../src/manifest.js'
import { apply } from '../src/apply.js'
import { getPhotoSequence, getSelection } from '../src/store.js'
import { isUsable, verify } from '../src/verify.js'
import { languageName } from '../src/locale.js'
import { costOf, describe as describeCost, formatCost, rateFor } from '../src/cost.js'
import { typeVocabulary } from '../src/vocabulary.js'
import { readCollectionNotes } from '../src/collection.js'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('planWindows', () => {
  it('returns a single window when everything fits', () => {
    assert.deepEqual(planWindows(20, 25, 3), [{ start: 0, end: 20 }])
    assert.deepEqual(planWindows(25, 25, 3), [{ start: 0, end: 25 }])
  })

  it('overlaps consecutive windows', () => {
    let windows = planWindows(60, 25, 3)

    assert.equal(windows[0].start, 0)
    assert.equal(windows.at(-1).end, 60)

    for (let i = 1; i < windows.length; ++i) {
      assert.ok(
        windows[i].start < windows[i - 1].end,
        'consecutive windows must overlap')
    }
  })

  it('covers every photo', () => {
    for (let n of [1, 2, 26, 47, 60, 200]) {
      let covered = new Set()

      for (let { start, end } of planWindows(n, 25, 3)) {
        for (let i = start; i < end; ++i) covered.add(i)
      }

      assert.equal(covered.size, n, `every photo covered for n=${n}`)
    }
  })
})

describe('reconcile', () => {
  const doc = (first, last, title = `${first}-${last}`) =>
    ({ first, last, title, confidence: 'high' })

  it('passes a single window through', () => {
    let { documents } = reconcile([
      { documents: [doc(1, 3), doc(4, 5)], unassigned: [], openAtEnd: false }
    ])

    assert.deepEqual(documents.map(d => [d.first, d.last]), [[1, 3], [4, 5]])
  })

  it('drops documents the previous window already reported', () => {
    let { documents } = reconcile([
      { documents: [doc(1, 3), doc(4, 6)], unassigned: [], openAtEnd: false },
      { documents: [doc(4, 6), doc(7, 9)], unassigned: [], openAtEnd: false }
    ])

    assert.deepEqual(
      documents.map(d => [d.first, d.last]), [[1, 3], [4, 6], [7, 9]])
  })

  it('prefers the later window for a document straddling the edge', () => {
    // The first window sees pages 6-7 and stops; the second sees the whole
    // run 6-9 because that is what the overlap is for.
    let { documents } = reconcile([
      { documents: [doc(1, 5), doc(6, 7)], unassigned: [], openAtEnd: true },
      { documents: [doc(6, 9)], unassigned: [], openAtEnd: false }
    ])

    assert.deepEqual(documents.map(d => [d.first, d.last]), [[1, 5], [6, 9]])
  })

  it('lets a document win over a page called unassigned elsewhere', () => {
    let { documents, unassigned } = reconcile([
      { documents: [], unassigned: [1, 2], openAtEnd: false },
      { documents: [doc(2, 4)], unassigned: [], openAtEnd: false }
    ])

    assert.deepEqual(unassigned, [1])
    assert.equal(documents.length, 1)
  })
})

describe('resolve', () => {
  const photoIds = [11, 12, 13, 14, 15]

  it('maps page numbers onto photo ids', () => {
    let [d] = resolve(
      { documents: [{ first: 2, last: 4, title: 'x' }] }, photoIds)

    assert.deepEqual(d.photos, [12, 13, 14])
  })

  it('rejects a page beyond the item', () => {
    assert.throws(
      () => resolve({ documents: [{ first: 4, last: 9 }] }, photoIds),
      /names page 6.*has 5 photos/)
  })

  it('rejects a photo assigned twice', () => {
    assert.throws(
      () => resolve({
        documents: [{ first: 1, last: 3 }, { first: 3, last: 4 }]
      }, photoIds),
      /assigned to more than one document/)
  })
})

// A stand-in for Tropy's store that behaves the way the real explode and merge
// commands do: asynchronously, and reporting the result only through state.
function fakeStore({ batchId = 1, photos = [11, 12, 13, 14] } = {}) {
  let next = 100
  let listeners = []

  let state = {
    items: { [batchId]: { id: batchId, photos: [...photos], tags: [] } },
    photos: Object.fromEntries(photos.map(id => [id, { id, item: batchId }])),
    metadata: {},
    tags: {}
  }

  let notify = () => { for (let fn of [...listeners]) fn() }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.push(fn)
      return () => { listeners = listeners.filter(x => x !== fn) }
    },
    dispatch(action) {
      // Asynchronous on purpose: the real commands are sagas, so nothing is
      // observable on the state by the time dispatch returns.
      setTimeout(() => {
        switch (action.type) {
          case 'item.explode': {
            for (let photo of action.payload.photos) {
              let id = ++next
              state.items[id] = {
                id, photos: [photo], tags: [...state.items[batchId].tags]
              }
              state.photos[photo] = { ...state.photos[photo], item: id }
            }
            state.items[batchId] = {
              ...state.items[batchId],
              photos: state.items[batchId].photos
                .filter(p => !action.payload.photos.includes(p))
            }
            break
          }
          case 'item.merge': {
            let [target, ...rest] = action.payload
            let folded = rest.flatMap(id => state.items[id].photos)
            state.items[target] = {
              ...state.items[target],
              photos: [...state.items[target].photos, ...folded]
            }
            for (let id of rest) delete state.items[id]
            for (let p of folded) state.photos[p] = { ...state.photos[p], item: target }
            break
          }
          case 'metadata.save':
            // Tropy's Save command destructures `{ ids, data }` and treats
            // ids as an array — see src/commands/metadata/save.js. The fake
            // must be just as strict, or it hides a wrong payload shape.
            if (!Array.isArray(action.payload.ids))
              throw new Error('metadata.save needs payload.ids as an array')
            // metadata_values.datatype is NOT NULL, and Tropy only fills it in
            // when the value is a bare string — an object without `type` is
            // rejected by SQLite, not by the command.
            for (let [uri, v] of Object.entries(action.payload.data)) {
              if (typeof v !== 'string' && !v.type)
                throw new Error(`metadata value for ${uri} has no datatype`)
            }
            for (let id of action.payload.ids)
              state.metadata[id] = { ...action.payload.data }
            break
          case 'tag.create': {
            let id = ++next
            state.tags[id] = { id, name: action.payload.name }
            for (let item of action.payload.items) {
              state.items[item] = {
                ...state.items[item], tags: [...state.items[item].tags, id]
              }
            }
            break
          }
          default:
            throw new Error(`unexpected action ${action.type}`)
        }
        notify()
      }, 0)
    }
  }
}

describe('apply', () => {
  it('explodes and merges a manifest into document-level items', async () => {
    let store = fakeStore()

    let documents = resolve({
      documents: [
        { first: 1, last: 2, title: 'Letter', date: '1781', confidence: 'high' },
        { first: 3, last: 4, title: 'Minute', confidence: 'low', note: 'unclear' }
      ]
    }, [11, 12, 13, 14])

    let { items: created, warnings } = await apply(store, {
      items: [1], documents, reviewTag: 'for review'
    })

    assert.deepEqual(warnings, [])
    assert.equal(created.length, 2)

    let state = store.getState()

    for (let id of created) {
      assert.equal(state.items[id].photos.length, 2)
    }

    // The batch item survives as an empty dossier shell.
    assert.deepEqual(state.items[1].photos, [])

    let title = 'http://purl.org/dc/elements/1.1/title'
    assert.equal(state.metadata[created[0]][title].text, 'Letter')

    // The date lands on dc:date, replacing the one inherited from the
    // dossier, with tropy#date as its datatype so ranges parse.
    let date = 'http://purl.org/dc/elements/1.1/date'
    assert.equal(state.metadata[created[0]][date].text, '1781')
    assert.equal(
      state.metadata[created[0]][date].type, 'https://tropy.org/v1/tropy#date')

    // Confidence is recorded where a reader will see it.
    let description = 'http://purl.org/dc/elements/1.1/description'
    assert.match(state.metadata[created[1]][description].text, /confidence: low/)

    let tag = Number(Object.keys(state.tags)[0])
    for (let id of created) assert.ok(state.items[id].tags.includes(tag))
  })

  it('leaves unassigned photos on the batch item', async () => {
    let store = fakeStore()

    let documents = resolve(
      { documents: [{ first: 2, last: 3, title: 'Letter' }] },
      [11, 12, 13, 14])

    await apply(store, { items: [1], documents, reviewTag: null })

    assert.deepEqual(store.getState().items[1].photos, [11, 14])
  })

  it('refuses a photo that does not belong to the item', async () => {
    let store = fakeStore()

    await assert.rejects(
      apply(store, {
        items: [1],
        documents: [{ first: 1, last: 1, photos: [99] }],
        reviewTag: null
      }),
      /not in the selection/)
  })
})

const model = (id, display_name, image = true, structured = true) => ({
  id,
  display_name,
  capabilities: {
    image_input: { supported: image },
    structured_outputs: { supported: structured }
  }
})

// The Models API auto-paginates on iteration, so the fake is an async iterable.
const fakeClient = (models, err) => ({
  models: {
    list: () => ({
      async *[Symbol.asyncIterator]() {
        if (err) throw err
        for (let m of models) yield m
      }
    })
  }
})

describe('isUsable', () => {
  it('requires image input and structured outputs', () => {
    assert.ok(isUsable(model('a', 'A')))
    assert.ok(!isUsable(model('a', 'A', false, true)))
    assert.ok(!isUsable(model('a', 'A', true, false)))
    assert.ok(!isUsable(undefined))
  })
})

describe('verify', () => {
  const models = [
    model('claude-opus-5', 'Claude Opus 5'),
    model('claude-sonnet-5', 'Claude Sonnet 5'),
    model('text-only-1', 'Text Only', false)
  ]

  it('returns the model when the key and id are good', async () => {
    let found = await verify(fakeClient(models), 'claude-opus-5')
    assert.equal(found.display_name, 'Claude Opus 5')
  })

  it('reports a rejected key plainly', async () => {
    await assert.rejects(
      verify(fakeClient([], { status: 401 }), 'claude-opus-5'),
      /API key was rejected/)
  })

  it('names the models that would work when the id is unknown', async () => {
    await assert.rejects(
      verify(fakeClient(models), 'claude-opus-4'),
      (err) => {
        assert.match(err.message, /no model called "claude-opus-4"/)
        assert.match(err.message, /claude-opus-5, claude-sonnet-5/)
        // A model that cannot see is not offered as an alternative.
        assert.ok(!err.message.includes('text-only-1'))
        return true
      })
  })

  it('refuses a model that cannot read images', async () => {
    await assert.rejects(
      verify(fakeClient(models), 'text-only-1'),
      /Text Only cannot be used here.*image input/)
  })
})

describe('assertDistinct', () => {
  const scans = (...hashes) => hashes.map((hash, i) => ({ hash, id: i }))

  it('passes when the pages differ', () => {
    assertDistinct(scans('a', 'b', 'c', 'd'))
  })

  it('catches every page rendering identically', () => {
    assert.throws(
      () => assertDistinct(scans('a', 'a', 'a', 'a')),
      /all 4 pages rendered to the same image/)
  })

  it('reports partial duplication without rejecting it', () => {
    // Blank versos and microfilm frames legitimately repeat.
    assert.equal(assertDistinct(scans('a', 'a', 'a', 'a', 'b', 'c')), 3)
  })

  it('says nothing about a single page', () => {
    assertDistinct(scans('a'))
  })
})

describe('apply, when metadata cannot be written', () => {
  it('keeps the split and reports what did not land', async () => {
    let store = fakeStore()

    // A store that accepts the split but silently drops metadata, which is
    // exactly what a wrong payload shape looked like.
    let dispatch = store.dispatch
    store.dispatch = (action) => {
      if (action.type === 'metadata.save') return
      return dispatch(action)
    }

    let documents = resolve({
      documents: [{ first: 1, last: 2, title: 'Letter', confidence: 'high' }]
    }, [11, 12, 13, 14])

    let { items, warnings } = await apply(store, {
      items: [1], documents, reviewTag: 'for review', timeout: 200
    })

    assert.equal(items.length, 1)
    assert.equal(store.getState().items[items[0]].photos.length, 2)
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /no metadata on item/)
  })
})

describe('languageName', () => {
  it('names every locale Tropy ships', () => {
    assert.equal(languageName('fr'), 'French')
    assert.equal(languageName('ja'), 'Japanese')
    assert.equal(languageName('nl-NL'), 'Dutch (Netherlands)')
    assert.equal(languageName('pt-BR'), 'Brazilian Portuguese')
  })

  it('handles Tropy shipping cn for Chinese, which is not a language tag', () => {
    assert.equal(languageName('cn'), 'Chinese')
  })

  it('falls back rather than throwing on anything unexpected', () => {
    assert.equal(languageName(undefined), 'English')
    assert.equal(languageName(''), 'English')
    assert.equal(languageName('xx'), 'xx')
  })
})

describe('metadata datatypes', () => {
  it('gives every value a datatype, not just dates', async () => {
    let store = fakeStore()
    let seen = null

    let dispatch = store.dispatch
    store.dispatch = (action) => {
      if (action.type === 'metadata.save') seen = action.payload
      return dispatch(action)
    }

    let documents = resolve({
      documents: [{
        first: 1, last: 2, title: 'Letter', date: '1777-1778',
        type: 'lettre', creator: 'Dunois', confidence: 'low', note: 'unclear'
      }]
    }, [11, 12, 13, 14])

    await apply(store, { items: [1], documents, reviewTag: null })

    let values = Object.values(seen.data)
    assert.ok(values.length >= 5)
    assert.ok(values.every(v => typeof v.type === 'string' && v.type))

    // The date goes on dc:date — the property the dossier and templates use,
    // so a document's own date replaces the one it inherited — and carries
    // tropy#date as its *datatype*, which is what makes ranges parse.
    let date = seen.data['http://purl.org/dc/elements/1.1/date']
    assert.equal(date.text, '1777-1778')
    assert.equal(date.type, 'https://tropy.org/v1/tropy#date')
    assert.equal(seen.data['https://tropy.org/v1/tropy#date'], undefined)
    assert.equal(
      seen.data['http://purl.org/dc/elements/1.1/title'].type,
      'http://www.w3.org/2001/XMLSchema#string')
  })
})

describe('cost', () => {
  it('prices a model, including dated snapshots', () => {
    assert.deepEqual(rateFor('claude-opus-5'), { input: 5, output: 25 })
    assert.deepEqual(rateFor('claude-haiku-4-5-20251001'), { input: 1, output: 5 })
  })

  it('lets an explicit tariff override the built-in table', () => {
    assert.deepEqual(
      rateFor('claude-opus-5', { input: 2, output: 10 }), { input: 2, output: 10 })
    // A half-set override is ignored rather than half-applied.
    assert.deepEqual(
      rateFor('claude-opus-5', { input: 2, output: 0 }), { input: 5, output: 25 })
  })

  it('says nothing rather than guessing for an unknown model', () => {
    assert.equal(rateFor('claude-something-9'), null)
    assert.equal(costOf({ input: 1e6, output: 1e6 }, null), null)
    assert.match(
      describeCost({ input: 100, output: 10, rate: null }), /no published rate/)
  })

  it('prices a real run', () => {
    // The Ribet dossier: 24 pages, one pass.
    let usd = costOf({ input: 29264, output: 3188 }, rateFor('claude-opus-5'))
    assert.ok(Math.abs(usd - 0.2260) < 0.0005, `got ${usd}`)
  })

  it('rounds to the cent, without making a real cost read as free', () => {
    assert.equal(formatCost(0.226), '$0.23')
    assert.equal(formatCost(12.5), '$12.50')
    assert.equal(formatCost(0.004), '<$0.01')
    assert.equal(formatCost(0.006), '$0.01')
  })
})

describe('typeVocabulary', () => {
  const T = 'http://purl.org/dc/elements/1.1/type'
  const project = (...terms) => ({
    metadata: Object.fromEntries(
      terms.map((text, i) => [i, text == null ? {} : { [T]: { text } }]))
  })

  it('ranks by how often the project uses a term', () => {
    assert.deepEqual(
      typeVocabulary(project('Report', 'Correspondence', 'Correspondence')),
      ['Correspondence', 'Report'])
  })

  it('ignores blanks, missing values and untyped items', () => {
    assert.deepEqual(typeVocabulary(project('Report', '  ', null, undefined)),
      ['Report'])
  })

  it('trims, but does not case-fold — the project decides its own style', () => {
    // Order between two terms used equally often is a tie, so assert the set.
    let vocab = typeVocabulary(project(' Report ', 'report'))
    assert.equal(vocab.length, 2)
    assert.ok(vocab.includes('Report') && vocab.includes('report'))
  })

  it('caps the list so a messy project cannot flood the prompt', () => {
    let many = Array.from({ length: 50 }, (_, i) => `type ${i}`)
    assert.equal(typeVocabulary(project(...many)).length, 12)
  })

  it('says nothing when there is no project to learn from', () => {
    assert.deepEqual(typeVocabulary({}), [])
    assert.deepEqual(typeVocabulary(undefined), [])
  })
})

describe('readCollectionNotes', () => {
  let dir

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'segmenter-test-'))
  })

  const write = async (name, body) => {
    let path = join(dir, name)
    await writeFile(path, body)
    return path
  }

  it('reads the notes a user points at', async () => {
    let path = await write('notes.md', '# Collection\n\nRepublican dates stay.')
    assert.match(await readCollectionNotes(path), /Republican dates stay\./)
  })

  it('is absent when no file is configured', async () => {
    assert.equal(await readCollectionNotes(''), '')
    assert.equal(await readCollectionNotes(undefined), '')
  })

  // Notes add to a policy that already stands on its own, so nothing here is
  // worth failing a run for.
  it('carries on when the file is missing', async () => {
    let warned = []
    let logger = { warn: (m) => warned.push(m), info: () => {} }

    assert.equal(
      await readCollectionNotes(join(dir, 'nope.md'), { logger }), '')
    assert.match(warned[0], /could not read collection notes/)
  })

  it('carries on when the file is empty', async () => {
    let path = await write('empty.md', '   \n\n  ')
    assert.equal(await readCollectionNotes(path), '')
  })

  it('refuses a file large enough to distort every run', async () => {
    let warned = []
    let logger = { warn: (m) => warned.push(m), info: () => {} }
    let path = await write('huge.md', 'x'.repeat(2000))

    assert.equal(await readCollectionNotes(path, { logger, limit: 1000 }), '')
    assert.match(warned[0], /the limit is/)
  })
})

// A pile of separately imported scans: one photo per item, which is the
// already-exploded state.
function looseScans(count) {
  let next = 100
  let listeners = []

  let state = { items: {}, photos: {}, metadata: {}, tags: {} }

  for (let i = 1; i <= count; ++i) {
    state.items[i] = { id: i, photos: [10 + i], tags: [] }
    state.photos[10 + i] = { id: 10 + i, item: i }
  }

  let notify = () => { for (let fn of [...listeners]) fn() }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.push(fn)
      return () => { listeners = listeners.filter(x => x !== fn) }
    },
    dispatch(action) {
      setTimeout(() => {
        switch (action.type) {
          case 'item.explode': {
            for (let photo of action.payload.photos) {
              let id = ++next
              state.items[id] = { id, photos: [photo], tags: [] }
              state.photos[photo] = { ...state.photos[photo], item: id }
            }
            let from = action.payload.id
            state.items[from] = {
              ...state.items[from],
              photos: state.items[from].photos
                .filter(p => !action.payload.photos.includes(p))
            }
            break
          }
          case 'item.merge': {
            let [target, ...rest] = action.payload
            let folded = rest.flatMap(id => state.items[id].photos)
            state.items[target] = {
              ...state.items[target],
              photos: [...state.items[target].photos, ...folded]
            }
            for (let id of rest) delete state.items[id]
            for (let p of folded)
              state.photos[p] = { ...state.photos[p], item: target }
            break
          }
          case 'metadata.save':
            for (let id of action.payload.ids)
              state.metadata[id] = { ...action.payload.data }
            break
          default:
            throw new Error(`unexpected action ${action.type}`)
        }
        notify()
      }, 0)
    }
  }
}

describe('apply, over a pile of separately imported scans', () => {
  it('merges them into documents without exploding anything', async () => {
    let store = looseScans(6)
    let dispatched = []
    let dispatch = store.dispatch
    store.dispatch = (a) => { dispatched.push(a.type); return dispatch(a) }

    let documents = resolve({
      documents: [
        { first: 1, last: 3, title: 'Letter', confidence: 'high' },
        { first: 4, last: 6, title: 'Minute', confidence: 'high' }
      ]
    }, [11, 12, 13, 14, 15, 16])

    let { items } = await apply(store, {
      items: [1, 2, 3, 4, 5, 6], documents, reviewTag: null
    })

    // Nothing to explode: every photo was already alone on its item.
    assert.ok(!dispatched.includes('item.explode'))

    assert.equal(items.length, 2)
    assert.deepEqual(store.getState().items[items[0]].photos, [11, 12, 13])
    assert.deepEqual(store.getState().items[items[1]].photos, [14, 15, 16])
  })

  it('leaves a scan that belongs to no document alone', async () => {
    let store = looseScans(4)

    let documents = resolve(
      { documents: [{ first: 2, last: 3, title: 'Letter' }] },
      [11, 12, 13, 14])

    await apply(store, { items: [1, 2, 3, 4], documents, reviewTag: null })

    let state = store.getState()
    assert.deepEqual(state.items[1].photos, [11])
    assert.deepEqual(state.items[4].photos, [14])
  })

  it('refuses a photo whose item was not selected', async () => {
    let store = looseScans(4)

    await assert.rejects(
      apply(store, {
        items: [1, 2],
        documents: [{ first: 1, last: 1, photos: [13] }],
        reviewTag: null
      }),
      /not in the selection/)
  })
})

describe('the selection', () => {
  it('reads in list order, not in the order items were clicked', () => {
    let state = {
      nav: { items: [30, 10, 20] },
      qr: { items: [10, 20, 30, 40] }
    }
    assert.deepEqual(getSelection(state), [10, 20, 30])
  })

  it('falls back to the whole list when nothing is selected', () => {
    assert.deepEqual(
      getSelection({ nav: { items: [] }, qr: { items: [7, 8] } }), [7, 8])
  })

  it('keeps items the list does not know about, at the end', () => {
    let state = { nav: { items: [99, 20, 10] }, qr: { items: [10, 20] } }
    assert.deepEqual(getSelection(state), [10, 20, 99])
  })

  it('reads photos item by item, in order', () => {
    let state = {
      items: { 1: { photos: [11, 12] }, 2: { photos: [21] }, 3: {} }
    }
    assert.deepEqual(getPhotoSequence(state, [1, 2, 3]), [11, 12, 21])
  })
})
