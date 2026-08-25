# Notes

Observations from real runs, kept here until they turn into changes. Anything
true of one collection rather than of archives generally belongs in a
collection notes file — see `collections/` — not here.

## Still to do

**Pass 2 does not exist.** The design has always been two passes: a cheap one
over downscaled images to find boundaries, then a closer look. Pass 1 records a
confidence per document and the report surfaces the low ones, which is the
groundwork, but nothing visits them. It should be **exception-driven**: read
only the pages pass 1 flagged — an unreadable date, an uncertain
correspondent, an ambiguous boundary — rather than the first and last page of
every document. On a 33-document dossier that is a handful of pages instead of
sixty-six, and 1024px already proves enough to *read* most datelines and
signatures, not merely to see their shape.

**Passes run serially.** "Does a document start on page N?" depends almost
entirely on pages N-1 and N, so windows are nearly independent and could run
concurrently — a wall-clock win that grows with dossier size. The reconciliation
already assumes windows may disagree.

**Resolution is untested.** 1024px was chosen by argument, not measurement. If
the cues survive 768 or 512, every run gets cheaper in proportion.

**A cheaper model may be enough for boundaries.** Discontinuity detection is
perceptual and the three-question rule was written to be mechanical. The risk
is asymmetric: a missed boundary yields one item holding two documents, easy to
fix; a false boundary yields two half-documents carrying confident wrong
metadata, which reads as complete. Evaluate on **false-boundary rate**, not
overall accuracy.

**Joining is the other half.** A group of individually imported scans is the
same problem read backwards: which of these belong together as one document.
Explode-then-merge already handles the general case, and the manifest already
describes documents as runs of photos rather than as cuts, so the missing piece
is a selection of many items rather than one, and a manifest whose page numbers
span them.

**A Gregorian date could be derived** for sorting, as long as it lives in its
own field and is marked as derived — never overwriting the transcription.

## Benchmarks

Two dossiers with known answers:

- **ANOM E 157 (Dunois)** — 60 photos, 33 documents. Hard cases: a document
  breaking off mid-sentence at the last photo, two documents on one leaf,
  duplicate pairs, two wrappers, and dates that do not run in order.
- **ANOM Série E (Ribet)** — 24 photos, 17 documents, one unassigned. A
  24-page PDF rather than loose JPEGs, so it also exercises page handling.

## Measurements

- **Cost**: Ribet, 24 pages, Claude Opus 5 at high effort — **$0.23**, 29.3k
  tokens in, 3.2k out. Roughly a cent a page.
- **Image cost is priced by dimensions, not content.** ~1,180 tokens for a
  1024px page. Input token count therefore proves images of the right *size*
  arrived, never that they showed anything — which is why identical renders
  have to be detected separately.
- **Output**: ~130 tokens per page at high effort, thinking included.

## Failure modes worth remembering

**An empty manifest says nothing about itself.** A run that returns zero
documents looks identical whether the model found nothing, the images were
blank, or every page rendered the same. Log the response.

**A plausible date is indistinguishable from a correct one.** The earlier
prototype silently converted Republican dates to Gregorian ISO and no test,
log or dialog could have caught it — only reading the output did.

**Metadata that fails to save can look like success.** Tropy updates state
before writing to the database, so a state predicate goes green on a write that
is about to be rejected. The failure is in Tropy's log, not the plugin's.

**Test doubles encode the author's misunderstanding.** The fake store passed
twice while the real thing failed, because it accepted the wrong payload shape
and untyped values. A double for something you are still learning should be
*stricter* than the real thing, not more forgiving.

## Operational

Two failure modes have cost more time than the work itself:

- Tropy lacking macOS permission to read the folder holding the photos. Every
  render fails and the log shows `EPERM`.
- Two builds sharing a product name. A locally built "Tropy Beta" and an
  installed one are indistinguishable in the Dock and in System Settings, so
  the permission can be granted to one and the app launched from the other.
  Give a local build a distinct product name.
