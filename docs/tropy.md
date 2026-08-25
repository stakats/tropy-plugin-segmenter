# Working against Tropy from a plugin

What a session picking this up cold would otherwise have to rediscover. Checked
against Tropy `1.18.0-beta.4` on the `api-explode-merge` branch, with file and
line references so it can be rechecked as the source moves.

None of this goes through Tropy's REST API. A plugin runs inside the
application, so everything is done in process: `context.window.store` to
dispatch and read state, `context.sharp` to render, `context.dialog` to talk to
the user.

## The plugin surface

**Hooks Tropy invokes** — `import`, `export`, `extract`, `transcribe`, declared
as booleans in `package.json` under `hooks` (`src/common/plugins.js:229`).
There is no segmentation hook, so this plugin hangs off `export`, which is what
puts it in the item context menu.

**The context** is `{ logger, dialog, json, sharp, window }` —
`src/window.js:44` passes `{dialog, json, sharp, window: this}` and
`src/common/plugins.js:44` adds `logger`.

**`sharp` is Tropy's own wrapper** (`src/image/sharp.js`): `open(path, options)`
returns a sharp instance with `failOn: 'none'` already set. Options pass
through, which is how `page` and `density` reach it.

**The store is reachable but undocumented.** `src/window.js:110` assigns
`this.store = store`, and the context carries `window: this`. Nothing
guarantees it stays there.

**The export payload carries no ids.** `getExportItems`
(`src/selectors/export.js:13`) serialises through a whitelist
(`src/common/export.js:50-97`): photos get `checksum`, `filename`, `path`,
`page`, `mimetype`; items get `template` plus metadata, tags and lists. No item
id, no photo id. Treat the hook as a trigger and read `state.nav.items`
instead.

**A plugin cannot contribute a menu entry.** `available()` is consulted for
exactly four actions (`src/main/menu.js:428,446,467,632`), each filling a slot
Tropy declared for it in `res/menu/*.yml`. The context menu is built from
static YAML plus a hardcoded `Menu.ItemCompiler` map; `src/common/plugins.js`
contains no mention of menus, and the spec `scan()` builds has no menu field.
"Transcribe Selected Items" looks like a plugin adding a command but is a
hand-written YAML entry plus `compileTranscriptionMenu`.

**A plugin is invisible until it has a config instance.** `available()`
iterates `this.config`, not `this.spec` (`src/common/plugins.js:52`), so
installing is not enough — an instance must be added in Preferences. The menu
label is that instance's `name`, falling back to `plugin #id`; it is *not*
`productName`.

**Plugin code is cached by URL.** `import(spec.main)` has no cache-buster
(`src/common/plugins.js:188`), so a new build at the same path is invisible
until the app restarts. Reinstalling through the UI does not help.

**Installing is a zip.** `install()` unzips with `strip: true`
(`src/common/plugins.js:132`), which unwraps a single top-level directory, and
names the folder from the filename minus `.zip` and a trailing `-1.2.3`. That
pattern needs a digit after the dash, so `-v0.1.0` survives into the installed
folder name — do not prefix the version with `v`.

## Settings

**What options can render**: `bool`/`boolean` → toggle, `template`, `property`,
`save-file`, and everything else falls through to `FormField` with `spec.type`
handed to an HTML `<input>` (`src/components/plugin/option.js:48-78`). So
`password` masks a field and `file` gives a file picker — which is how the
collection notes are supplied.

**No dropdown and no read-only field.** Both exist elsewhere in Tropy —
`FormSelect` renders the template Type menu, `isReadOnly` the greyed project
fields — but `option.js:9-21` builds `attrs` as a fixed nine-key literal and
never spreads the spec, so no key in `package.json` can reach them.

**Wiring both in is small and confined to `option.js`.** `Select`'s defaults
(`src/components/completions.js:265-269`) are `toId = value.id || String(value)`
and `toText = value.name || String(value)`, so `[{id, name}]` works with no
custom renderer. Do not route through `FormSelect`, whose `toText` runs options
through i18n and would render plugin labels as missing translation keys.

**No plugin code runs in the settings panel.** No button type, no `onBlur`
reaching the plugin, and changing options does not re-create the instance — a
`config.json` write triggers `reload()`, not `create()`
(`src/common/plugins.js:112`). Verification has to happen when a hook runs.

**Options are stored in cleartext** in `<plugins>/config.json`. There is no
keychain. `password` masks the field in the UI, which is not the same thing.

## Commands

**Explode + merge compose into a split.** `Explode` moves each listed photo
onto a *duplicate* of its item; `Merge` folds items back together. Explode
every assigned photo out, then merge each document's photos back — photos are
reassigned, never duplicated, and both register undo.

**Metadata inheritance is free, and total.** `Explode` duplicates via
`mod.item.dup`, so every new item arrives carrying the dossier's title,
identifier, date, rights, template, tags and lists. Anything not overwritten
stays — which is why an unwritten title silently reads as the dossier's.

**The batch item survives** as an empty shell holding the dossier-level record.

**A plugin cannot await a command.** `rsvp` — how the REST API reads a
command's result — is an IPC round trip implemented in main
(`src/main/api.js:24`, `src/sagas/ipc.js:57`, `src/main/wm.js:372`), with no
renderer-side equivalent. `src/store.js` dispatches and waits on a predicate
over state instead.

**A state predicate cannot tell "written" from "optimistically applied".**
`metadata.save` puts the update into state *before* writing to the database
(`src/commands/metadata/save.js:36`) and rolls state back via `abort()` if the
write throws. Verify after everything settles, and read Tropy's log.

### Writing actions by hand

A plugin is bundled separately and cannot import Tropy's action creators, so
actions are constructed literally — and the creators do more than they look.

- **`metadata.save` takes `payload.ids`, an array.** The creator normalises
  `{id}` → `{ids: [id]}` (`src/actions/metadata.js:87`); the command
  destructures `{ ids, data }`. Passing `{id}` writes nothing, silently.
- **Every metadata value needs a datatype.** `metadata_values.datatype` is
  `NOT NULL`, and the command fills it in only for values given as bare strings
  (`src/commands/metadata/save.js:31`). An object without `type` is rejected by
  SQLite after the optimistic state update has already looked like success.
- **`tropy#date` is a datatype, not a property.** The property is `dc:date` —
  the one the templates and the dossier use. Writing to `tropy#date` as a
  property puts the value where nothing displays it and leaves the inherited
  date visible.
- **`item.tag.create` resolves tag names but does not create missing tags**,
  and `tag.create` with `meta.resolve` returns an existing tag *without*
  attaching it to the items. The two cases have to be told apart.
- `explode`, `merge` and `item.tags.create` pass their payloads through
  unchanged.

**The store holds the whole project's metadata.** `sagas/project.js:129`
dispatches `metadata.load()` with no argument on project open, so the existing
`dc:type` vocabulary can be read straight from state.

**Photos know their page.** A PDF or multi-page TIFF puts every page behind one
path and distinguishes them with `page`. Ignoring it renders page one N times.

## Running in the renderer

Tropy loads windows with `loadFile` and `webSecurity` on, and the preload has
full Node (`sandbox: false`, `src/main/wm.js:47-50`).

- The Anthropic SDK's browser check is `window && document && navigator`, all
  true here, so `dangerouslyAllowBrowser: true` is required.
- Requests carry `Origin: null` and Chromium enforces CORS. Without
  `anthropic-dangerous-direct-browser-access: true` the preflight is answered
  `400` with no `access-control-allow-origin`; with it, `200` and `*`. The SDK
  does not send it.

## Diagnosis

`~/Library/Logs/Tropy*/tropy.log`, JSON per line. Tropy logs command failures
there that a plugin never sees — the `metadata_values.datatype` constraint was
found this way, seventeen times over, while the plugin reported success.

## Open upstream asks

In the order they are worth doing:

1. **Plugin-contributed context menu commands**, or a `segment` hook. Today the
   action hides under "Export Item", a verb meaning roughly the opposite of
   what it does. A hook is the smaller change and `compileTranscriptionMenu` is
   the template; contributed menu items are the better general answer.
2. **`select` and `readonly` option types** — small, confined to `option.js`.
3. **A supported way to await a command's result**, replacing the predicate
   workaround.
4. **Encrypted option storage** (Electron `safeStorage`). `readonly` without it
   is a locked door on a glass wall.

Related, both open: `tropy#985` (explode, merge and nav routes for the REST
API) and `tropy#984` (transcription state).
