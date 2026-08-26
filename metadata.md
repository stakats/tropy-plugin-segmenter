# Recording policy

**This file governs what is written into each document's metadata, and nothing
else depends on its wording.** It is the companion to `segmentation.md`, which
governs only where one document ends and the next begins. Both are inlined into
the plugin at build time and are meant to be revised on their own — per
collection, or as experience accumulates — without touching the plugin's code.

Everything above the last section is meant to hold for any archive. Anything
true only of a particular collection belongs under *Collection-specific
practice*, and can be replaced wholesale.

## Transcribe, do not interpret

The record should say what the document says. A reader who disagrees with a
reading must be able to see what it was read from; a value that has been
silently corrected, converted or completed has destroyed the evidence for
checking it.

So, for every field taken from the page:

- **Do not convert between calendars.** A date in a calendar other than the
  Gregorian one is recorded in the calendar the document uses. A conversion may
  be arithmetically right and still be an inference wearing the clothes of a
  transcription.
- **Do not normalize to a standard format.** A date is not rewritten as ISO,
  and a name is not reordered or regularized.
- **Do not modernize spelling**, expand abbreviations, or correct what looks
  like a slip. Archaic and irregular forms are evidence.
- **Do not supply precision the document does not carry.** If only the month is
  given, record the month. An approximate date stays approximate, and a range
  stays a range.
- **Leave it empty rather than guess.** A missing value is honest; an invented
  one is not, and cannot be told apart from a real one later.

## Dates

Record the date itself: not the place it was written, and not the words that
attach it to the surrounding sentence. Two documents dated the same day should
record the same way, whatever phrasing the clerk used around the date.

Everything that is *about* the date stays — its calendar, its wording, its
spelling, and its imprecision.

## Language

The record for a document is written in the language of **that document**.
Nothing else decides it: not the language of the software, not the language of
the dossier as a whole, and not whether a value was transcribed from the page
or composed to describe it. A title you write for an untitled document is in
the document's language, exactly as a transcribed one would be.

Where a body of material is in one language, the records come out consistent
because the material is, not because consistency was imposed. Mixed and
multilingual holdings are ordinary — a Spanish letter filed among French ones,
a Latin certificate, a translation bound with its original — and their records
should differ from their neighbours', because their documents do.

The exception is anything addressed to the person using the software rather
than to the record — see *Notes* below.

## Titles

A document that carries its own title keeps it, as written.

A document that carries none needs one written for it. Describe what the
document is and who it concerns, in as few words as will identify it in a list
of its neighbours. It is a finding aid, not a summary.

## Type

Type is a **classification**, not a transcription: it is assigned by the
cataloguer, and its value is that it groups documents together. So it follows
the conventions of the project it is being added to, not the language or
wording of the document in hand.

Keep terms short, singular and consistent. A term that needs a parenthetical
gloss is a description, not a type; whatever needed explaining belongs in the
note instead.

## Notes

The note is the one field addressed to the person using Tropy rather than to
the record. It is where uncertainty goes — an unreadable date, a doubtful
correspondent, an ambiguous boundary — along with anything a reader would want
flagged: a document running past the end of the item, two documents sharing a
leaf, a duplicate of another item.

## Collection-specific practice

Everything above is deliberately generic. Cues, examples and conventions that
hold only for a particular collection belong here, and are additive: they can
make a rule concrete, but should not contradict one.

*Nothing recorded here.* Collection practice is better kept outside the plugin
entirely: point the **Collection notes** preference at a Markdown file of your
own and it is appended to the prompt at run time, so it can be edited, kept
under version control and shared without rebuilding anything.

`collections/` in this repository holds examples to copy or point at.
