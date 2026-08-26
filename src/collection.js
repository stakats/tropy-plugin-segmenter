// Collection notes: the one part of the prompt that belongs to the user
// rather than to the plugin.
//
// The built-in policies are written to hold for any archive. What is true only
// of one collection — its calendar, its document types, how its wrappers and
// surrogates behave — is read at run time from a Markdown file the user points
// the Collection notes preference at, so it can be edited in a real editor,
// kept under version control and shared, without rebuilding anything.

import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { readFile, stat } from 'node:fs/promises'

// Large enough for a thorough set of notes, small enough that pointing the
// preference at the wrong file cannot quietly triple the cost of every run.
export const LIMIT = 32 * 1024

// Returns `{ text, source }` — `source` naming the file and a short digest of
// its contents, for the provenance note. Empty text means the built-in policy
// stood alone.
export async function readCollectionNotes(path, { logger, limit = LIMIT } = {}) {
  if (!path) return { text: '', source: null }

  try {
    let { size } = await stat(path)

    if (size > limit)
      throw new Error(
        `the file is ${Math.round(size / 1024)}KB, and the limit is ${
          Math.round(limit / 1024)}KB`)

    let notes = (await readFile(path, 'utf-8')).trim()

    if (!notes) {
      logger?.warn(`collection notes at ${path} are empty`)
      return { text: '', source: null }
    }

    let digest = createHash('sha256').update(notes).digest('hex').slice(0, 8)

    logger?.info(
      `collection notes: ${notes.length} characters from ${path} (${digest})`)

    return { text: notes, source: `${basename(path)} ${digest}` }

  } catch (err) {
    // Notes are an addition to a policy that already stands on its own, so a
    // bad path is worth saying out loud but not worth stopping for.
    logger?.warn(`could not read collection notes from ${path}: ${err.message}`)
    return { text: '', source: null }
  }
}
