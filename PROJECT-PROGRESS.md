# DeckCard — Build Progress & Plan

> **What this file is for:** a shared map between you and Claude of _what we
> intend to build_ and _how far we've got_. If a session runs out of tokens or
> Claude loses context, point it back here and say **"resume from
> PROJECT-PROGRESS.md — we stopped at \_\_\_"** and it can pick up exactly where
> we left off.

**Product (one sentence):** an offline Chinese flashcard app for pushing the
language from intermediate to expert, where each card logs the word (typed or
drawn), a real sentence it was met in, its pinyin, and its definition — all
three of the latter fill themselves in from bundled data the moment the word
is entered.

**Run it:** `npm install`, then `npx ng serve` → http://localhost:4200
**Build check:** `npx ng build` (passes clean)
**Tests:** `npx ng test` (222 passing)
**Sync setup:** `supabase/README.md` (one-time, manual)

---

## Decisions already settled (don't re-litigate without a reason)

- **Chinese only.** The model used to be language-agnostic; it is not any more.
  `Deck.language` survives as a deprecated field so old rows and backups still
  read, but nothing branches on it and templates hardcode `lang="zh-Hans"`.
- **Four authored fields: word, sentence, pinyin, definition.** The old
  structured usage note (register / collocations / confusables) was removed in
  Dexie v2 — it was the most expensive field to author and the least often
  filled. Definition (field 4) replaced it as auto-filled data instead.
- **Pinyin reuses `Card.reading`, definition reuses `Card.meaning`**, rather
  than adding properties. Both were already documented, searched, displayed,
  and backed up under those names.
- **Manual capture, no mining.** Still true: no auto-ingest, no segmenter. The
  handwriting pad, the corpus picker, and the dictionary reduce typing, not
  choosing.
- **Two scheduling rows per card** (recognition + production), toggled per deck.
- **No RxJS anywhere**, including Dexie `liveQuery`. Stores expose signals and
  reload explicitly after writes.
- **Everything heavy is lazy.** pinyin-pro, the recogniser, the stroke database,
  the corpus, the dictionary, and supabase-js all load on first use. The initial
  bundle stays ~253 kB against a 500 kB warning budget — check this after any
  dependency change.
- **The app is GPL-3.0**, because HanziLookupJS is. Accepted deliberately.
- **Handwriting is online-first.** HanziLookup filters by stroke count and
  aligns strokes in drawn order, so wrong order or joined strokes lose the right
  character. When connected, strokes go to Google Input Tools (undocumented
  endpoint, CORS-open, order-insensitive); offline, or on any failure, it falls
  back to HanziLookup. Drawings leave the device when online — credited and
  disclosed in Settings.
- **Sync is Supabase, local-first.** Dexie stays the source of truth for every
  screen; `SyncService` mirrors it to Postgres in the background (pull, then
  push; newest `updatedAt` wins; deletes travel as tombstones). The Postgres
  schema uses typed snake_case columns so a future web app can use it directly.
  Sign-in is email + password with Supabase "Confirm email" off, so no email
  is ever sent. Emailed codes were tried first and dropped: Supabase's built-in
  sender allows 2 emails/hour to team addresses only. Magic links are out too
  (a link opens the browser, not the installed PWA, which has separate storage). Folder
  auto-backup was removed; manual Export/Import JSON remains as an escape hatch.

---

## Status

| Area                                    | File(s)                          | Status  |
| --------------------------------------- | -------------------------------- | ------- |
| Data model                              | `core/models/card.types.ts`      | ✅ Done |
| Dexie schema + migrations (v4 = sync)   | `core/db/`                       | ✅ Done |
| FSRS wrapper, queue, `blankTerm`        | `core/review/scheduler.ts`       | ✅ Done |
| Deck / card / session / settings stores | `core/state/`                    | ✅ Done |
| JSON export + import (backup v2)        | `core/backup/`                   | ✅ Done |
| Cloud sync (Supabase)                   | `core/sync/`, `supabase/`        | ✅ Code done — project not yet created |
| Pinyin derivation                       | `core/pinyin/`                   | ✅ Done |
| Example-sentence corpus                 | `core/corpus/`, `scripts/`       | ✅ Done |
| Definition dictionary (CC-CEDICT)       | `core/dictionary/`, `scripts/`   | ✅ Done |
| Handwriting pad + recognisers           | `shared/handwriting/`            | ✅ Done |
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
- **Components must not have an `async ngOnInit`** where a spec drives them.
  `review` and `card-editor` wrap their loads in `PendingTasks.run(...)` so
  `ApplicationRef.isStable` — and therefore `fixture.whenStable()` — accounts
  for them. Specs must never call `ngOnInit()` by hand.
- **`assetUrl()` for every runtime asset.** A root-absolute `/hanzi/...` works in
  dev and 404s on GitHub Pages under `--base-href /flashcard/`.
- **The vendored recogniser is byte-identical to upstream plus one line.** See
  `src/app/shared/handwriting/vendor/README.md` before re-vendoring.
- **Don't widen HanziLookup's looseness.** Measured on 口 and 十: 0.3 and 0.5
  never rescue wrong stroke order, and 0.3 pushes joined-stroke 口 out of the
  top 8 that 0.15 kept it in.
- **Google's handwriting response mixes in punctuation** (一 arrives with `-`,
  `_`, `/`). `parseCandidates` keeps Han characters only.
- **`CompositeRecognizer.status` is `ready` whenever online**, even if the
  offline stroke DB failed to load — the pad hides candidates on `unavailable`.
- **Corpus coverage is thin above ~HSK 5.** Tatoeba skews beginner. 顽固 has
  **zero** sentences, which is why it is no longer the placeholder. Placeholders
  now use 突然 (56 hits). Check coverage before changing them again.
- **Field 2 and field 4 auto-fill, and must not clobber typed content.**
  `sentenceMode` and `meaningMode` mirror `pinyinMode`: typing takes the field
  over, emptying the box hands it back.
- **Fields 2, 3, and 4 derive in parallel from `setTerm()`**, via
  `Promise.all`, each with its own three-way staleness guard.
- **Never import `SyncService` from `app.config.ts` statically.** It pulls Dexie
  and the sync layer into the initial bundle. The app initializer `import()`s it.
  `SupabaseBackend` likewise `import()`s supabase-js on first use.
- **`updatedAt` is stamped by Dexie hooks, not by callers**
  (`FlashcardDb.trackChanges`). It is the push cursor, so a write that bypasses
  the hooks never syncs. Writes inside `db.applyRemote(...)` are deliberately
  unstamped, unannounced, and untombstoned — that is what stops pulled rows
  echoing back. The tag lives on the underlying `IDBTransaction`, which nested
  Dexie transactions share.
- **Tombstones are written after the deleting transaction commits** (hooks
  can't write outside their scope). A crash in that gap resurrects the row on
  next pull — accepted. `table.clear()` fires no hooks, so `clearAll()` never
  deletes anything in the cloud.
- **Sync cursors are saved only after pull *and* push succeed**; a failure
  re-runs both, and re-applying a row is harmless. Pulls re-read 5 s behind the
  cursor because `server_updated_at` is a transaction-start time.
- **`lastExportAt` is per-device** and never synced; a pull keeps the local one.

---

## Where we stopped (update this line each session)

**Last checkpoint:** _2026-09-14 — Two changes. (1) Handwriting: added
`GoogleInputRecognizer` + `CompositeRecognizer` (online-first, HanziLookup
fallback); looseness tuning was tried and measured worse. (2) Storage: Supabase
sync replaces folder auto-backup. Dexie v4 adds indexed `updatedAt` on all
synced tables, `tombstones`, `syncState`, drops `handles`. New `core/sync/`
(mappers, backend seam, Supabase backend, `SyncService`), Settings "Account &
sync" (email + password sign-in, sync now, storage persistence line), deck list
nudges sign-in instead of folder restore. SQL + setup steps in `supabase/`.
Also calls `navigator.storage.persist()` at start. 222 tests passing, initial
bundle ~253 kB. Not yet exercised against a real Supabase project or in a real
browser._

_Previously: 2026-08-10 — Field 4 (Definition) auto-filled from a bundled
CC-CEDICT; field 2 auto-fills immediately; placeholders moved to 突然._

**Next up:**

- [ ] Create the Supabase project and fill `core/sync/supabase.config.ts`
      (`supabase/README.md`), then sign in on the device that has the cards first.
- [ ] Try sync end-to-end on two browsers: add, edit, grade, delete, offline edit.
- [ ] Verify handwriting on a real touch device, online and in airplane mode.
- [ ] Deploy to GitHub Pages and install to phone — the workflow pushes on branch
      `claude/flashcard-app-planning-5d2rxb`, not `main`.
- [ ] Tag filtering on the browse screen (data is already stored and searchable).
- [ ] Per-deck FSRS retention rather than one global setting.
- [ ] Filter Traditional out of the corpus properly (OpenCC would be exact).
- [ ] Capacitor wrap for a native Android build with share-sheet capture.

> When you want to continue, tell Claude: **"resume from PROJECT-PROGRESS.md, do
> \<the next item\>."** If tokens run low mid-task, Claude should update the
> **Last checkpoint** line above before stopping.
