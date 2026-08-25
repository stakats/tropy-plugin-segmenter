// Tropy's UI locale, turned into something a model can be asked to write in.
// Kept apart from `model.js` so it can be tested without a build step.

// Tropy ships `cn` for Chinese, which is not a language subtag — it is the
// country code for China. Everything else it ships is already a valid tag.
const ALIASES = { cn: 'zh' }

export function languageName(locale, fallback = 'English') {
  if (!locale) return fallback

  let tag = ALIASES[locale] || locale

  try {
    // Ask in English so the instruction reads the same way whatever the
    // locale is: "Write these in French", not "Write these in français".
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(tag) || tag
  } catch {
    return tag
  }
}
