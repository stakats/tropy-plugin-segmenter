// Collection notes: the one part of the prompt that belongs to the user
// rather than to the plugin.
//
// The built-in policies are written to hold for any archive. What is true only
// of one collection — its calendar, its document types, how its wrappers and
// surrogates behave — is read at run time from a Markdown file the user points
// the Collection notes preference at, so it can be edited in a real editor,
// kept under version control and shared, without rebuilding anything.

import { readFile, stat } from 'node:fs/promises'

// Large enough for a thorough set of notes, small enough that pointing the
// preference at the wrong file cannot quietly triple the cost of every run.
export const LIMIT = 32 * 1024

export async function readCollectionNotes(path, { logger, limit = LIMIT } = {}) {
  if (!path) return ''

  try {
    let { size } = await stat(path)

    if (size > limit)
      throw new Error(
        `the file is ${Math.round(size / 1024)}KB, and the limit is ${
          Math.round(limit / 1024)}KB`)

    let notes = (await readFile(path, 'utf-8')).trim()

    if (!notes) {
      logger?.warn(`collection notes at ${path} are empty`)
      return ''
    }

    logger?.info(`collection notes: ${notes.length} characters from ${path}`)

    return notes

  } catch (err) {
    // Notes are an addition to a policy that already stands on its own, so a
    // bad path is worth saying out loud but not worth stopping for.
    logger?.warn(`could not read collection notes from ${path}: ${err.message}`)
    return ''
  }
}
