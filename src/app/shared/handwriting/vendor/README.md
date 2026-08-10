# Vendored: HanziLookupJS

Offline Chinese handwriting recognition. Not published to npm, so the built file
is committed here rather than installed.

| | |
| --- | --- |
| Upstream | <https://github.com/gugray/HanziLookupJS> |
| File | `dist/hanzilookup.min.js` |
| Commit | `7770c99fa7b48c448f2dfa00dff87fea6cce9529` |
| Retrieved | 2026-08-10 |
| Original size | 12,384 bytes |
| Committed size | 12,413 bytes (see modification below) |

## The one modification

A single line is appended to the end of the file, and nothing else is touched:

```js
export default HanziLookup;
```

That is enough to turn it into an ES module. The source is a series of
`var HanziLookup = HanziLookup || {};` statements; under module scope `var`
hoisting makes the first read `undefined`, so `undefined || {}` creates the
object without needing a browser global. Every function in the bundle already
declares `"use strict"`, so it is strict-mode clean.

Making it a module is what lets `import('./vendor/hanzilookup.min.js')` become a
lazy chunk, keeping 12 kB of recogniser out of the initial bundle and out of the
way of users who never draw a character.

## The data file

`public/hanzi/mmah.json` (827,350 bytes, 9,507 characters) comes from the same
`dist/` directory at the same commit. It lives under `public/` so it is copied
to the output root and fetched on demand; `ngsw-config.json` caches it lazily.

`orig.json` (1.27 MB, 15,652 characters) is the alternative. `mmah` was chosen
for its substroke centre-point data, its smaller size, and its lighter licence.

## We do not call `init()`

`HanziLookup.init(name, url, cb)` fetches over `XMLHttpRequest`. The app fetches
the JSON itself and then replicates what `init`'s callback does:

```js
HanziLookup.data[name] = JSON.parse(text);
HanziLookup.data[name].substrokes = HanziLookup.decodeCompact(HanziLookup.data[name].substrokes);
```

That keeps the network call in `fetch`, where failures are ordinary rejections
and the URL can be built through `assetUrl()` for the `/flashcard/` base href.

If you re-vendor a newer build, re-check that this decode step still matches
upstream's `init` — it is the one piece of internal behaviour we depend on.

## Licences

- **Code (`hanzilookup.min.js`)** — GNU GPL v3. This is why the app as a whole is
  GPL-3.0; see the root `LICENSE`.
- **Data (`mmah.json`)** — Arphic Public License, derived from Shaunak Kishore's
  *Make Me a Hanzi*, itself derived from Arphic fonts.

Both are reproduced under `public/licenses/` and credited in the app's Settings
screen.
