# Flashcards — Build Progress & Plan

> **What this file is for:** a shared map between you and Claude of _what we
> intend to build_ and _how far we've got_. If a session runs out of tokens or
> Claude loses context, point it back here and say **"resume from
> PROJECT-PROGRESS.md — we stopped at \_\_\_"** and it can pick up exactly where
> we left off.

**Product (one sentence):** an offline flashcard app for pushing a language from
intermediate to expert, where each card logs the word, a real sentence it was met
in, and a usage note covering register, collocations, and near-synonym contrast.

**Run it:** `npm install`, then `npx ng serve` → http://localhost:4200
**Build check:** `npx ng build` (passes clean)
**Tests:** `npx ng test` (78 passing)

---

## Decisions already settled (don't re-litigate without a reason)

- **Manual capture, language-agnostic.** No auto-mining, no dictionary ingestion.
  The alternative — ingest text, segment, diff against known words, surface i+1
  unknowns — is more powerful past HSK 6 but is Chinese-only, needs a segmenter
  and a cold-start sweep, and buries you in review debt. Manual was chosen for
  portability and because a card you chose is worth more than one you were handed.
- **The counter-risk is capture friction**, and the card editor is built to fight
  it: three visible fields, everything else collapsed, `Ctrl+Enter` save-and-next,
  select-a-word-in-the-sentence to fill the term.
- **Two scheduling rows per card** (recognition + production), toggled per deck.
- **The door is left open.** A card is `{term, sentence, usage, language}`, so any
  future capture mechanism is an input adapter producing that same shape.
- **Stack matches `finance-blog`**: Angular 21 standalone, signals, OnPush, SCSS,
  Vitest, npm. Only two runtime deps added: `dexie`, `ts-fsrs`.
- **No RxJS anywhere**, including Dexie `liveQuery`. Stores expose signals and
  reload explicitly after writes.

---

## Status

| Area                                    | File(s)                     | Status  |
| --------------------------------------- | --------------------------- | ------- |
| Data model                              | `core/models/card.types.ts` | ✅ Done |
| Dexie schema + shared queries           | `core/db/`                  | ✅ Done |
| FSRS wrapper, queue, `blankTerm`        | `core/review/scheduler.ts`  | ✅ Done |
| Deck / card / session / settings stores | `core/state/`               | ✅ Done |
| JSON export + import                    | `core/backup/`              | ✅ Done |
| Deck list                               | `pages/deck-list/`          | ✅ Done |
| Card editor                             | `pages/card-editor/`        | ✅ Done |
| Browse + search                         | `pages/card-browse/`        | ✅ Done |
| Review screen + keyboard                | `pages/review/`             | ✅ Done |
| Settings                                | `pages/settings/`           | ✅ Done |
| Stats                                   | `pages/stats/`              | ✅ Done |
| PWA shell (manifest, service worker)    | `public/`, `app.config.ts`  | ✅ Done |

**v1 is complete and building clean.** Nothing is half-finished.

---

## Where we stopped (update this line each session)

**Last checkpoint:** _2026-08-09 — v1. Full app scaffolded and built: model,
Dexie persistence, FSRS scheduling with two directions per card, all seven
screens, JSON backup, PWA shell. 78 tests passing, `ng build` clean._

**Next up (all optional — v1 needs none of these):**

- [ ] Deploy to GitHub Pages (`ng build --base-href /flashcard/`) and install to phone.
- [ ] Tag filtering on the browse screen (data is already stored and searchable).
- [ ] Per-deck FSRS retention rather than one global setting.
- [ ] Capacitor wrap for a native Android build with share-sheet capture — this is
      what would make capture near-frictionless from a reading app.
- [ ] Reconsider the mining route only if manual capture proves too slow in practice.

> When you want to continue, tell Claude: **"resume from PROJECT-PROGRESS.md, do
> \<the next item\>."** If tokens run low mid-task, Claude should update the
> **Last checkpoint** line above before stopping.
