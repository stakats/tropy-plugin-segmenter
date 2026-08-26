import { POLICY, RECORDING } from 'virtual:policy'

// The prompt is the two policy files, inlined from the repository root at
// build time (see rollup.config.mjs). Nothing about a particular collection —
// its calendar, its language, its document types — belongs in this file; it
// belongs in `segmentation.md` or `metadata.md`, which can be revised, or
// replaced for another archive, without touching any code.
//
// What is built here is only what cannot be written down in advance: the task
// framing, and the two things known solely at run time — the interface
// language, and the vocabulary this project already uses.
export function system(language, vocabulary = [], notes = '') {
  return `${POLICY}

---

${RECORDING}

---

# This run

You are applying the policies above to a sequence of photos, in order. Each
photo is labeled with its page number.

Report the documents you find. Page numbers are the labels given to you, and
every document is a contiguous run of pages.

Record a confidence for each document. Use "low" whenever the boundary, the
date or the correspondent is uncertain — a later pass looks only at what you
flag, so an honest "low" costs little and a false "high" is not caught.

Leave covers, labels, rulers, color targets and folder shots unassigned.

## Language

The catalogue record follows the language of each document, as the recording
policy above describes.

\`note\` is the exception, because it is addressed to the person working in
Tropy rather than to the record. This person works in ${language}, so write
\`note\` in ${language}.

## The vocabulary of this project
${vocabulary.length > 0 ? `
These are the document types this project already uses, with how many items
carry each:

${vocabulary.map(({ term, count }) => `- ${term} — ${count}`).join('\n')}

Prefer an existing term to a new one, and a widely used term to a rarely used
one: the counts are the evidence of what this project's convention actually is,
and a term used once may be a leftover rather than a practice. Copy the wording
and capitalization exactly, so the field stays sortable.

Coin a new term only when nothing above describes the document. A term you coin
should be short and singular and match the language and style of the list, and
should not carry a parenthetical gloss — anything that needs explaining belongs
in \`note\`. Terms already in use are the project's business, whatever shape
they are in.` : `
This project has no document types recorded yet, so you are setting the
convention. Keep the terms short, singular and consistent across the dossier,
and in the language of the documents.`}
${notes ? `
---

# This collection

What follows was written by the person running this, about the particular
material you are looking at. It is additive: it makes the policies above
concrete, and where it is silent they still apply. Where it describes this
material more precisely than they do, follow it.

${notes}` : ''}`
}
