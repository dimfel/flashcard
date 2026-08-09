# Flashcards

A vocabulary flashcard app built for pushing a language from intermediate toward
expert — where the bottleneck stops being _"what does this word mean"_ and
becomes _"when does using this word make me sound wrong."_

Every card carries three authored fields:

1. **Word** — the vocab item (顽固)
2. **Sentence** — a real sentence you met it in
3. **Usage note** — register, collocations, and near-synonym contrast

Field 3 is the one that does the intermediate→expert work. Reading, gloss, and
translation are optional supporting metadata, not one of your three slots.

Nothing in the data model is language-specific: it holds Chinese, Japanese,
Spanish, or medical terminology equally well.

## Running it

```bash
npm install
npx ng serve      # http://localhost:4200
npx ng test       # Vitest
npx ng build      # production build into dist/
```

## How it works

- **Offline-first.** Everything lives in IndexedDB via Dexie. There is no server
  and no account. Installable to a phone home screen as a PWA.
- **FSRS scheduling** via [`ts-fsrs`](https://github.com/open-spaced-repetition/ts-fsrs),
  wrapped in `core/review/scheduler.ts` so the algorithm never leaks into
  components.
- **Two directions per card.** Recognition (see the word → recall it) and
  production (see the sentence with the word blanked → produce it) are scheduled
  independently, because they're different memories that decay at different
  rates. Toggle per deck.
- **Back up your cards.** Settings → Export JSON. Browser storage is not durable;
  clearing site data wipes everything. The export file doubles as sync — keep it
  in cloud storage and import on another device.

## Layout

```
src/app/core/
  models/card.types.ts     data model, the integration seam
  db/                      Dexie schema, shared queries
  review/scheduler.ts      ts-fsrs wrapper, queue building, blankTerm
  state/                   signal-based stores (no RxJS)
  backup/                  JSON export/import
src/app/pages/             one folder per route
```

## Conventions

Standalone components, `OnPush` everywhere, signals for all state — no RxJS and
no `liveQuery`, so there is exactly one reactivity model to reason about.

## Keyboard

In review: `Space` reveal · `1`–`4` grade · `E` edit · `Z` undo.
In the editor: `Ctrl`/`Cmd`+`Enter` saves and opens the next blank card.
