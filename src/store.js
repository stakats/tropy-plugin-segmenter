// Everything the plugin does to the project goes through Tropy's Redux store,
// in process. There is no HTTP hop and no REST API involved.
//
// `context.window.store` is an escape hatch, not a supported API: `src/window.js`
// passes `window: this` into the plugin context and assigns `this.store` when
// the view loads. Nothing guarantees it stays there.

export function getStore(context) {
  let store = context?.window?.store

  if (store == null || typeof store.dispatch !== 'function')
    throw new Error(
      'this plugin needs Tropy\'s project window; open a project and try again')

  return store
}

// The selection Tropy would have exported. `getExportItems` reads the same
// slice, but the export payload itself carries no ids, so the store is the
// only way to learn which items are selected.
export function getSelection(state) {
  return (state.nav?.items?.length > 0) ? state.nav.items : (state.qr?.items ?? [])
}

export function getPhotos(state, ids) {
  return ids.map(id => state.photos[id]).filter(Boolean)
}

// Dispatch an action and wait until the store satisfies `isDone`.
//
// A plugin cannot await a command: `rsvp` — the mechanism the REST API uses to
// read a command's payload back — is an IPC round trip implemented in the main
// process, and there is no renderer-side equivalent. So instead of reading the
// result we wait for a predicate over state that the command is known to
// establish. Callers must pick a predicate that is false beforehand, otherwise
// this resolves immediately on a stale state.
export function dispatchAndWait(store, action, isDone, options = {}) {
  let { timeout = 120000, label = action.type } = options

  return new Promise((resolve, reject) => {
    if (isDone(store.getState())) {
      resolve(store.getState())
      return
    }

    let unsubscribe = null
    let settled = false

    let done = (fn, arg) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (unsubscribe) unsubscribe()
      fn(arg)
    }

    let timer = setTimeout(() => {
      done(reject, new Error(`timed out after ${timeout}ms waiting for ${label}`))
    }, timeout)

    unsubscribe = store.subscribe(() => {
      let state = store.getState()
      if (isDone(state)) done(resolve, state)
    })

    try {
      store.dispatch(action)
    } catch (err) {
      done(reject, err)
    }
  })
}
