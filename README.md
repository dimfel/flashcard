# DeckCard

A Chinese vocabulary flashcard app built for pushing the language from
intermediate toward expert, with capture friction as the thing it fights hardest.

Every card carries three authored fields:

1. **Word** — the vocab item (顽固). Type it, or **draw it** on the handwriting
   pad if you have no Chinese IME to hand.
2. **Sentence** — a real sentence you met it in. Type it, or pull one from a
   bundled Tatoeba corpus.
3. **Pinyin** — derived from the word automatically, and editable when the
   derivation guesses a polyphone wrong.

Meaning, sentence translation, and tags are optional supporting metadata, not one
of the three slots.

## Running it

```bash
npm install
npx ng serve      # http://localhost:4200
npx ng test       # Vitest
npx ng build      # production build into dist/
```

## How it works

- **Offline-first.** Everything lives in IndexedDB via Dexie. There is no server
  and no account, and the app makes no third-party network requests. Installable
  to a phone home screen as a PWA.
- **Handwriting input.** A canvas under field 1 turns strokes into candidate
  characters, matched entirely on-device against a 827 kB stroke database. Both
  the recogniser and its data are lazy: draw nothing and you download neither.
- **Pinyin on tap.** `pinyin-pro` converts the whole term at once, so it resolves
  polyphones from context — 银行 comes out `yín háng`, 行走 comes out `xíng zǒu`.
  Type over the field to correct it; clear it to hand control back.
- **Example sentences.** 38k filtered Chinese–English pairs from Tatoeba ship as
  a 2.5 MB file, fetched the first time you press the button and cached after.
  Coverage is good for common words and thin above roughly HSK 5 — Tatoeba skews
  beginner, and plenty of advanced words simply aren't in it.
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
- **Automatic backup (desktop Chrome/Edge).** Settings → Automatic backup → point
  it at a folder once, and `flashcards-latest.json` is rewritten there whenever
  you change something, plus one dated snapshot per day (last 14 kept). Nothing
  leaves your machine. Uses the File System Access API, which exists only in
  desktop Chromium — Firefox, Safari and every phone browser fall back to the
  manual export, and the panel says so rather than offering a dead button.

## Layout

```
src/app/core/
  models/card.types.ts     data model, the integration seam
  db/                      Dexie schema, migrations, shared queries
  review/scheduler.ts      ts-fsrs wrapper, queue building, blankTerm
  state/                   signal-based stores (no RxJS)
  backup/                  JSON export/import, plus auto-backup to a folder
  pinyin/                  lazily loaded pinyin derivation
  corpus/                  example-sentence search + fetch
  assets/asset-url.ts      base-href-safe asset URLs
src/app/shared/handwriting/  canvas pad, recogniser, vendored HanziLookupJS
src/app/pages/             one folder per route
scripts/build-corpus.mjs   regenerates public/corpus/cmn-eng.tsv
```

## Conventions

Standalone components, `OnPush` everywhere, signals for all state — no RxJS and
no `liveQuery`, so there is exactly one reactivity model to reason about.

Anything heavy is behind a dynamic `import()` or lives in `public/` and is
fetched on demand, so the initial bundle stays around 250 kB. Assets are
addressed through `assetUrl()`, never a root-absolute path, because the app
deploys under `/flashcard/`.

## Keyboard

In review: `Space` reveal · `1`–`4` grade · `E` edit · `Z` undo.
In the editor: `Ctrl`/`Cmd`+`Enter` saves and opens the next blank card.

## Where to point automatic backup

Anywhere except inside this repo while `ng serve` is running — the dev server
watches the project tree, so a backup written into it triggers a rebuild on every
save. A cloud-synced folder is the best choice: it survives a browser wipe *and*
a dead disk, and doubles as the sync mechanism the export file already supports.
If you do want backups in the project, put them somewhere like `backups/` and add
that to `.gitignore`.

Restoring: on a wiped browser the deck list offers **Choose backup folder…**,
since the folder handle lives in IndexedDB and dies alongside the cards. Point it
back at the folder and it reads `flashcards-latest.json` through the same
newest-wins merge as a manual import.

## Regenerating the example corpus

Roughly a once-a-year job. Download the three Tatoeba per-language exports,
decompress them (they are bz2; `bunzip2`, or Python's `bz2` module), then:

```bash
node scripts/build-corpus.mjs \
  --cmn cmn_sentences.tsv --eng eng_sentences.tsv --links cmn-eng_links.tsv
```

The output under `public/corpus/` is committed on purpose, so the deploy never
depends on a third-party download. Filters and their rationale are documented at
the top of the script.

## Licence

**GNU GPL v3** — see [`LICENSE`](LICENSE). The app bundles
[HanziLookupJS](https://github.com/gugray/HanziLookupJS), which is GPL-3.0, so
the combined work is too.

Third-party components and their licences are listed in
[`public/licenses/NOTICES.txt`](public/licenses/NOTICES.txt) and credited in the
app's Settings screen: HanziLookupJS (GPL-3.0), Make Me a Hanzi stroke data
(Arphic Public License), Tatoeba sentences (CC BY 2.0 FR), pinyin-pro (MIT),
ts-fsrs (MIT), Dexie (Apache-2.0).
