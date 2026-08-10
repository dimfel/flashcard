# DeckCard — Build Progress & Plan

> **What this file is for:** a shared map between you and Claude of _what we
> intend to build_ and _how far we've got_. If a session runs out of tokens or
> Claude loses context, point it back here and say **"resume from
> PROJECT-PROGRESS.md — we stopped at \_\_\_"** and it can pick up exactly where
> we left off.

**Product (one sentence):** an offline Chinese flashcard app for pushing the
language from intermediate to expert, where each card logs the word (typed or
drawn), a real sentence it was met in, and its pinyin.

**Run it:** `npm install`, then `npx ng serve` → http://localhost:4200
**Build check:** `npx ng build` (passes clean)
**Tests:** `npx ng test` (143 passing)

---

## Decisions already settled (don't re-litigate without a reason)

- **Chinese only.** The model used to be language-agnostic; it is not any more.
  `Deck.language` survives as a deprecated field so old rows and backups still
  read, but nothing branches on it and templates hardcode `lang="zh-Hans"`.
- **Three authored fields: word, sentence, pinyin.** The old structured usage
  note (register / collocations / confusables) was removed in Dexie v2 — it was
  the most expensive field to author and the least often filled.
- **Pinyin reuses `Card.reading`** rather than adding a property. It was already
  documented as pinyin, already searched, already displayed, already backed up.
- **Manual capture, no mining.** Still true: no auto-ingest, no segmenter. The
  handwriting pad and the corpus picker reduce typing, not choosing.
- **Two scheduling rows per card** (recognition + production), toggled per deck.
- **No RxJS anywhere**, including Dexie `liveQuery`. Stores expose signals and
  reload explicitly after writes.
- **Everything heavy is lazy.** pinyin-pro, the recogniser, the stroke database
  and the corpus all load on first use. The initial bundle stays ~250 kB against
  a 500 kB warning budget — check this after any dependency change.
- **The app is GPL-3.0**, because HanziLookupJS is. Accepted deliberately.

---

## Status

| Area                                    | File(s)                          | Status  |
| --------------------------------------- | -------------------------------- | ------- |
| Data model                              | `core/models/card.types.ts`      | ✅ Done |
| Dexie schema + v2 migration             | `core/db/`                       | ✅ Done |
| FSRS wrapper, queue, `blankTerm`        | `core/review/scheduler.ts`       | ✅ Done |
| Deck / card / session / settings stores | `core/state/`                    | ✅ Done |
| JSON export + import (backup v2)        | `core/backup/`                   | ✅ Done |
| Pinyin derivation                       | `core/pinyin/`                   | ✅ Done |
| Example-sentence corpus                 | `core/corpus/`, `scripts/`       | ✅ Done |
| Handwriting pad + recogniser            | `shared/handwriting/`            | ✅ Done |
| Deck list                               | `pages/deck-list/`               | ✅ Done |
| Card editor                             | `pages/card-editor/`             | ✅ Done |
| Browse + search                         | `pages/card-browse/`             | ✅ Done |
| Review screen + keyboard                | `pages/review/`                  | ✅ Done |
| Settings + credits                      | `pages/settings/`                | ✅ Done |
| Stats                                   | `pages/stats/`                   | ✅ Done |
| PWA shell (manifest, service worker)    | `public/`, `ngsw-config.json`    | ✅ Done |

---

## Things worth knowing before you touch them

- **`src/testing/fixtures.ts` uses only `import type`.** A value import there
  reaches `flashcard-db`, and Dexie snapshots `globalThis.indexedDB` at module
  evaluation. `fake-indexeddb` is installed by `src/testing/vitest-setup.ts`
  (wired in `angular.json`) so the ordering is deterministic; `getDb()` is lazy
  for the same reason.
- **Components must not have an `async ngOnInit`.** `review` and `card-editor`
  wrap their loads in `PendingTasks.run(...)` so `ApplicationRef.isStable` — and
  therefore `fixture.whenStable()` — accounts for them. Specs must never call
  `ngOnInit()` by hand: Angular calls it too, and the second, un-awaited call
  used to make the review spec flaky about one run in five.
- **`assetUrl()` for every runtime asset.** A root-absolute `/hanzi/...` works in
  dev and 404s on GitHub Pages under `--base-href /flashcard/`.
- **The vendored recogniser is byte-identical to upstream plus one line.** See
  `src/app/shared/handwriting/vendor/README.md` before re-vendoring.
- **Corpus coverage is thin above ~HSK 5.** Tatoeba skews beginner; 顽固, the
  app's own placeholder word, has zero sentences. The empty state says so.

---

## Where we stopped (update this line each session)

**Last checkpoint:** _2026-08-10 — Chinese-only pivot complete. Removed the
structured usage note (Dexie v2 + backup v2), made field 3 auto-derived pinyin,
added the offline handwriting pad, and shipped a 38k-pair Tatoeba corpus behind
an on-demand sentence picker. Added GPL-3.0 licensing and in-app credits. Fixed
a pre-existing flaky review spec caused by double `ngOnInit`. 143 tests passing,
`ng build` clean, initial bundle 253 kB._

**Next up (all optional):**

- [ ] Deploy to GitHub Pages and install to phone — the workflow exists but
      pushes on branch `claude/flashcard-app-planning-5d2rxb`, not `main`.
- [ ] Verify handwriting and the sentence picker on a real touch device; the pad
      is only mouse-tested so far.
- [ ] Tag filtering on the browse screen (data is already stored and searchable).
- [ ] Per-deck FSRS retention rather than one global setting.
- [ ] Filter Traditional out of the corpus properly (currently a character-set
      heuristic in `scripts/build-corpus.mjs`; OpenCC would be exact).
- [ ] Capacitor wrap for a native Android build with share-sheet capture.

> When you want to continue, tell Claude: **"resume from PROJECT-PROGRESS.md, do
> \<the next item\>."** If tokens run low mid-task, Claude should update the
> **Last checkpoint** line above before stopping.
