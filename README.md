# Segmenter — a Tropy plugin

Works out where the documents are in a pile of scans, and makes each one its
own item — in place, inside Tropy.

It reads a selection either way round. One item holding a whole dossier is
split into its documents; a heap of separately imported photos is gathered into
them. Both are the same question — *which of these pages belong together* —
and a selection can mix the two.

This is the self-contained shape described in [`docs/tropy.md`](docs/tropy.md):
the plugin calls a model itself, so it needs no Claude Code and no operator.

The judgment lives in two policy files at the repository root, inlined as the
prompt at build time:

| | |
|---|---|
| [`segmentation.md`](segmentation.md) | where one document ends and the next begins |
| [`metadata.md`](metadata.md) | what is recorded about each one |

**Neither is code, and neither should be edited in `src/`.** Both are written
to hold for any archive, with a final section for whatever is true only of one
collection — replace that section and the plugin suits a different archive
without a line of JavaScript changing. `src/` carries the mechanics and the two
things that cannot be written down in advance: Tropy's interface language, and
the document types the open project already uses.

## What it does

0. Checks the API key and the model before anything is rendered or billed.
1. Reads the selected item's photos from Tropy's store.
2. Downscales each one with Tropy's own `sharp`, in process.
3. Sends them to Claude in overlapping passes, and asks where the documents
   divide — one manifest per pass, reconciled into one.
4. Explodes every assigned photo out of the batch item, merges each document's
   photos back together, writes per-document metadata, and tags everything
   `for review`.

Photos are reassigned, never duplicated. The batch item survives as an empty
dossier shell holding the dossier-level record, and every step registers in
Tropy's undo history. Covers, labels and color targets stay on the shell.

## Installing

Download the `.zip` from the [latest release][releases], then in Tropy:

1. **Preferences → Plugins → Install Plugin**, and choose the zip.
2. Click **+** on the plugin to add an instance and give it a name. That name
   is what appears in the menu, so something like `Segment` reads well.
3. Open its **Settings** and paste an [Anthropic API key][key]. Nothing else is
   required — the rest of the options have working defaults.

Then select the items to segment — one holding many photos, or many holding one
each — and **right-click → Export Item →** your instance name. Nothing is exported: Tropy has no segmentation hook, and plugins
can only appear in the import, export, extract and transcribe menus, so the
export menu is the only place an item-scoped action can live.

**Turn Dry run on for your first go.** It reports what it would do and changes
nothing.

A run costs money, because it sends the pages to Anthropic. The confirmation
dialog shows an estimate before anything is spent and the report shows what it
actually cost — roughly a cent a page, or **$0.23** for a 24-page dossier
through Claude Opus 5.

> Replacing an existing install needs Tropy to be **fully quit and relaunched**;
> a first install does not. See *Developing* for why.

[releases]: https://github.com/stakats/tropy-plugin-segmenter/releases
[key]: https://console.anthropic.com/settings/keys

## Options

| Option | Default | |
|---|---|---|
| Anthropic API key | — | Required. See the warning below. |
| Model | `claude-opus-5` | Free text for now; checked at run time |
| Effort | `high` | `low`, `medium`, `high`, `xhigh`, `max` |
| Scan size | `1024` | Longest edge of the pass-1 copies, in pixels |
| Photos per pass | `25` | |
| Photos shared between passes | `3` | Overlap, so a straddling document is seen whole |
| Input $ / MTok | `0` | `0` uses the built-in rates |
| Output $ / MTok | `0` | Set both to price against another tariff |
| Collection notes | — | A Markdown file of your own; see below |
| Tag | `for review` | Applied to every item created |
| Tag for uncertain documents | `low confidence` | Applied only where the reading is doubtful |
| Dry run | off | Report the plan and change nothing |

Defaults come from `segmentation.json`; anything set here overrides them.

> **The API key is stored in plain text.** Tropy keeps plugin options in
> `config.json` in the plugins folder. There is no keychain and no encryption.
> The field is masked in the UI, which is not the same thing.

## Settings

The settings are plain text fields, because that is all Tropy's plugin options
can render today — no dropdown, no read-only field. Both are small additions to
`src/components/plugin/option.js` upstream, and `docs/tropy.md` records the
diff and why they are deferred.

Free-text fields make it easy to mistype a model id, so the plugin checks
before it spends anything: on each run it lists the available models, and fails
with a clear message if the key is rejected, if the model does not exist, or if
it cannot read images and be held to a JSON schema. A wrong model id is
answered with the ids that would have worked.

## Using it

Select what you want segmented and **right-click → Export Item →** your
instance name, at the bottom of the submenu after a separator. A multi-selection
puts it under "Export Selected Items" instead. File → Export is the same action.

Photos are read in the order the item list shows them, and within each item in
photo order — so sort the list the way the documents run before you start. The
order you happened to click in makes no difference.

A selection can mix the two shapes freely, and a document can span them — the
last page of a dossier and the loose scan that follows it can end up in the
same document. Two rules govern what happens to the items you started with:

- **An item holding more than one photo is split, and survives holding none.**
  It keeps whatever it recorded, which is the point when it was a dossier: the
  dossier-level description stays somewhere. When it was just a two-page scan,
  it is an empty item you may want to delete.
- **Each document is built on whichever item held its first page**, and
  inherits that item's metadata. So a loose scan that begins a document becomes
  that document; one that falls inside it is merged away. Tropy fills in any
  property the surviving item lacks from the ones merged into it, and unions
  their tags, so labels are not silently lost — but anything the plugin writes
  does overwrite what was there.

Two things about that placement are worth knowing, because both look like bugs:

- **Nothing is exported.** Tropy has no segmentation hook and plugins cannot
  contribute their own menu entries — they fill slots Tropy declares for the
  import, export, extract and transcribe hooks — so `export` is the only one
  that puts an item-scoped action in the context menu. `docs/tropy.md` records
  what an upstream fix would need.
- **A plugin with no instance is invisible.** The menu is built from
  `config.json`, not from what is installed, which is why adding an instance is
  a separate step from installing. The label is that instance's name, not the
  plugin's `productName`.

A confirmation dialog reports how many photos will be sent, and what it is
estimated to cost, before anything is billed.

## Running in the renderer

Two things follow from the plugin living in Tropy's renderer rather than in a
server process, and both are set in `src/model.js`:

- **`dangerouslyAllowBrowser: true`.** The SDK refuses to start when `window`,
  `document` and `navigator` all exist, which is true here even though this is
  a desktop app with full Node. The risk the flag guards against is shipping a
  key to untrusted end users of a web page; here the key belongs to the person
  running the app and is read from their own plugin config. `contextIsolation`
  keeps page scripts out of the world the plugin and the key live in.
- **`anthropic-dangerous-direct-browser-access: true`.** Tropy loads its
  windows with `loadFile`, so requests carry `Origin: null` and Chromium
  enforces CORS. Without this header the preflight is answered `400` with no
  `access-control-allow-origin`; with it, `200` and `*`. The SDK does not send
  it, so it goes in `defaultHeaders`.

A more thorough fix would hand the SDK a custom `fetch` backed by `node:https`,
which would leave Chromium's network stack — and CORS — out of it entirely. It
needs a shim that supports streaming responses, since the segmentation call
uses `messages.stream()`, so it is not done here.

## Language

The catalogue record — title, type, date, creator, recipient — is written in
the language of the documents, not in Tropy's interface language. A French
dossier should read as a French archivist would catalogue it, and a dossier
should never come back half in one language and half in another.

`note` is the exception: it is a remark to the person using Tropy rather than
part of the record, so it follows Tropy's UI locale (`state.intl.locale`, via
`src/locale.js`).

If you catalogue foreign-language material in your own language, this is the
wrong default for you — it should become an option, but plugin options cannot
render a dropdown yet, so it is left as a single rule for now.

## Collection notes

The built-in policies are written to hold for any archive. What is true only of
*your* material — its calendar, its document types, how its covers and
surrogates behave — goes in a Markdown file of your own, and the **Collection
notes** preference points at it. It is read at run time and appended to the
prompt.

That means it needs no rebuild, can be edited in a real editor, kept under
version control, and shared with colleagues working the same collection.

[`collections/anom-serie-e.md`](collections/anom-serie-e.md) is a worked
example — French colonial personnel dossiers on microfilm — to point at or copy.

Notes are additive: they make the policy concrete, and where they are silent it
still applies. They are also never load-bearing, so a missing, empty or
oversized file is logged and the run continues on the built-in policy alone.

## Provenance notes

**Every item this plugin creates gets a note** recording that a model made the
judgement, and enough about the run to weigh it:

> The day of the month is illegible.
>
> Pages 4–7 of Ribet, Jacques-Antoine, judged from 1024 px copies by
> claude-opus-5.
>
> > marker: tropy-segmenter/1
> > run: 5f3a9c1e, 2026-08-26 14:02 UTC
> > plugin: 0.2.6
> > model: claude-opus-5, effort high
> > images: 1024 px longest edge
> > source: item 4759, pages 4-7
> > confidence: medium
> > policy: segmentation.md 3f9a1c2b, metadata.md b7e04255
> > collection notes: anom-serie-e.md 1d5c8890

This is a stand-in. Until Tropy can record that a value came from a model
rather than from a person, a note is the only place that fact can live — so
these notes are what a real provenance layer would eventually have to be
migrated from. That shapes them:

- **Self-contained.** They cannot point at a run record kept elsewhere: a
  source item that gave up all its photos has none left to hold a note, and an
  item exported on its own must still carry its own provenance. The `run` id is
  what groups one run's items back together.
- **Parseable.** The marker and the labels are fixed strings, and the labels
  stay in English whatever language the remark is in.
- **Honest about what was seen.** The scan size matters more than anything else
  here. A date misread from a 1024 px copy is a different kind of error from one
  misread at full resolution, and nothing else in Tropy records it.
- **Digested, not described.** The prompt *is* `segmentation.md`, `metadata.md`
  and your collection notes, so each is recorded with a short digest. Without
  them, "was this item segmented under the current rules?" has no answer.

Re-segmenting **adds** a note rather than replacing one. Overwriting provenance
is the wrong instinct for provenance, and the run ids tell the passes apart.

Tokens and cost are deliberately absent: they are facts about a run, and
dividing them across documents would invent precision. They are in the log.

Documents read with less than full confidence are also tagged — by default
`low confidence`. Everything created gets the review tag, so the review tag
cannot tell you where to look; this one can.

The dialog at the end is a summary, not a transcript. An earlier version listed
every note in it, and on a dossier of seventeen documents it outgrew the screen
and took its own OK button with it.

## Cost

The confirmation dialog shows what a run will cost before it runs, and the
report shows what it actually cost.

The input half is **exact**, not estimated: the scans are rendered first, then
priced with `messages.countTokens`, which is a separate endpoint and is not
billed as inference. Only the output half is a guess, because thinking tokens
are billed as output and vary with effort; the report replaces the guess with
the real figure.

Costs are shown to the cent. For reference, a 24-page dossier through Claude
Opus 5 at high effort cost **$0.23** — 29.3k tokens in, 3.2k out.

Rates are not available from the API — no endpoint reports what a model costs —
so they are kept by hand in [`pricing.json`](pricing.json), beside the policies
rather than inside `src/`. They change on Anthropic's schedule, not this
plugin's, and keeping them in a data file means revising one number and
rebuilding, with nothing in the source to touch.

Every figure is shown with the date the prices were last checked — *"$0.23
(29.3k in, 3.2k out, at 2026-08-25 prices)"* — because a cost from a stale
table should not be able to pass for a current one. A model absent from the
table reports its tokens and says nothing about money, rather than printing a
confident wrong number. The two rate options override everything, for partner
tariffs, enterprise agreements, or an installed copy that cannot be rebuilt.

## Dates

Dates are transcribed, not interpreted. A document that says
`16 frimaire an 11` is recorded as `16 frimaire an 11` — not converted to
`1802-12-07`, not rewritten as ISO, not modernized from `7bre` to `septembre`,
and never given a day or month the page does not carry.

What is dropped is only what is not the date: the place, and the words that
attach the date to a sentence. `Versailles le 30 avril 1780`, `Du 30 avril
1780` and `ce 30 avril 1780` all record as `30 avril 1780`, so that two
documents dated the same day sort and read the same way whatever phrasing the
clerk used around them. That is what the `tropy#date` datatype is for: it lets a value
be a range, a republican date, or an approximation without having to be
coerced into something `xsd:date` would accept.

The earlier prototype did convert, silently and without recording the original.
A conversion may well be arithmetically right, but presented as the document's
own date it is an inference wearing the clothes of a transcription — and the
evidence for checking it has been discarded. If a sortable Gregorian date is
wanted later, it belongs in its own field, marked as derived.

## Known limitations

- **It cannot await a command.** Tropy's `rsvp` — the mechanism its REST API
  uses to read a command's result — is an IPC round trip implemented in the
  main process, with no renderer-side equivalent. So `src/store.js` dispatches
  and then waits for a predicate over store state instead. It is deterministic,
  but it is a workaround; see `PLUGIN-PORT.md`.
- **It reaches through `context.window.store`.** Undocumented, and nothing
  guarantees it stays there.
- **A whole run is many undo entries, not one.** Explode, each merge, each
  metadata write and the tag each register separately.
- **Passes run serially.** They are independent enough to parallelize — see
  `docs/notes.md` — but that is a change worth measuring first.
- **There is no second pass.** `NOTES.md` argues pass 2 should visit only what
  pass 1 flagged; for now pass 1 records a confidence and the report surfaces
  it, and low-confidence documents are left for a human.

## Layout

```
src/plugin.js     the export hook: selection, confirmation, orchestration, report
src/store.js      store access, and dispatch-and-wait
src/scan.js       sharp downscaling and window planning
src/model.js      the prompt, the schema, and the Anthropic call
src/verify.js     checking the key and the model
src/manifest.js   reconciling passes, and mapping pages onto photo ids
src/apply.js      explode, merge, metadata, tag
src/constants.js  Tropy's action types and RDF properties, by hand
```

`manifest.js`, `apply.js` and `verify.js` carry everything that does not need
the prompt, and are covered by `test/`,
against a fake store that behaves the way Tropy's commands do — asynchronously,
reporting results only through state. No model and no Tropy needed to run them.

## Developing

```bash
npm install && npm run build
```

`npm run build` inlines `segmentation.md`, `metadata.md`, `segmentation.json`
and `pricing.json` into the bundle, so **revising a policy means rebuilding
the plugin**. That is the intended workflow: the policies are expected to change
far more often than the code.

### Packaging

```bash
npm run dist
```

That writes `dist/tropy-plugin-segmenter-<version>.zip`, the same artifact
the release workflow publishes.

The bundle is self-contained — no `require`, no `node_modules`, no `src` — so
the zip carries only `index.js`, `package.json`, `icon.svg`, `LICENSE` and
`third-party-licenses.txt`. Tropy never installs a plugin's dependencies, which
is why `@anthropic-ai/sdk` is a *dev* dependency here: rollup inlines it.

The zip must be named `<name>-<version>.zip` and hold one folder of the same
name. Do not prefix the version with `v`: Tropy strips a trailing `-1.2.3` from
the filename to name the installed folder, and that pattern only matches a dash
followed by digits — `-v0.1.0` would survive into the folder name.

During development you can skip the zip and copy `index.js`, `package.json` and
`icon.svg` straight into the plugins folder.

**Tropy must be fully quit and relaunched to pick up a new build.** Plugins are
loaded with a plain `import(spec.main)` and the ES module cache is keyed by URL,
so replacing `index.js` at the same path changes nothing until the process
restarts — and reinstalling through the UI does not help, because the path is
the same.

Bump the version on every change — `npm run bump` — so the build that is
actually loaded can be read off Preferences → Plugins, which shows
`productName` and `version`.

There is a catch that makes this worth stating precisely: the version comes
from a **rescan** of `package.json`, while the code comes from the **module
cache**. A plugins reload without an app restart rescans the spec but re-uses
the cached module, so the panel would show the new version while the old code
is still running. Always restart, and the two agree.

### Releasing

Tag and push; `.github/workflows/release.yml` builds, tests, packages and
publishes a prerelease with the zip attached.

```bash
npm run bump          # or edit the version by hand
git commit -am "..." && git push
git tag -a v0.2.1 -m "..." && git push origin v0.2.1
```

The workflow refuses to run if the tag and `package.json` disagree, so a
release can never be named one thing and contain another.

## License

AGPL-3.0-or-later, the same license as Tropy itself. `LICENSE` is the
unmodified AGPL text and `COPYRIGHT` carries the notice — kept apart so that
GitHub and packaging tools can identify the license automatically.

Copyright (c) 2026 Corporation for Digital Scholarship, Vienna, Virginia, USA. Note this differs from the repository root, which is MIT: none
of that code is reused here.

The SPDX identifier is `AGPL-3.0-or-later` rather than the `AGPL-3.0` the older
Tropy plugins declare — the latter is deprecated, and Tropy's own `package.json`
uses `-or-later`.

Licenses of everything rollup inlines are collected into
`third-party-licenses.txt` at build time, and ship in the zip.
