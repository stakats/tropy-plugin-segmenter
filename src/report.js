// What the closing dialog says.
//
// Kept out of plugin.js so it can be tested: this is the plugin's main
// user-facing surface, and the one place where saying something untrue costs a
// tester two runs and a bug report.

// At most this many warnings are listed; the rest are in the log.
const SHOWN = 5

export function reportText(documents, manifest, {
  items = [], notes = 0, warnings = [], dryRun = false, cost = null,
  lowConfidenceTag = 'low confidence'
} = {}) {
  let uncertain = documents.filter(
    d => d.confidence && d.confidence !== 'high').length

  let photos = manifest.unassigned.length +
    documents.reduce((n, d) => n + d.photos.length, 0)

  let lines = [
    // Leading, not parenthetical: a dry run's report otherwise reads exactly
    // like a successful one, which is how a tester concludes the plugin is
    // broken rather than that the box is ticked.
    dryRun ?
      'Nothing in your project was changed. Turn off "Dry run" in the plugin ' +
      'settings and run it again to apply this.' :
      null,
    dryRun ? '' : null,

    `${documents.length} documents from ${photos} photos`,

    manifest.unassigned.length > 0 ?
      `${manifest.unassigned.length} left unassigned — covers, labels, targets` :
      null,

    // Nothing was tagged in a dry run, so nothing may claim to have been.
    uncertain > 0 ?
      `${uncertain} uncertain, ${dryRun ? 'would be tagged' : 'tagged'} ` +
      `"${lowConfidenceTag}"` :
      null,

    (!dryRun && notes > 0) ?
      `${notes} notes attached, on the first photo of each` :
      null,

    manifest.openAtEnd ?
      'The last document is still open at the final photo — it runs past the ' +
      'end of what was selected.' :
      null,

    // A dry run is billed like any other, so it reports what it cost.
    cost ? `\nActual cost: ${cost}` : null
  ].filter(line => line !== null)

  if (warnings.length > 0) {
    let shown = warnings.slice(0, SHOWN)

    lines.push(
      `\n${dryRun ? 'The plan is complete' : 'The segmentation is complete'}` +
      `, but:\n${shown.map(w => `• ${w}`).join('\n')}${
        warnings.length > shown.length ?
          `\n• and ${warnings.length - shown.length} more, in the log` : ''}`)
  }

  return {
    message: dryRun ?
      `Dry run — ${documents.length} documents found, nothing changed` :
      `Segmented into ${items.length} items`,
    detail: lines.join('\n')
  }
}
