/**
 * Resolves a runtime asset path against the page's `<base href>`.
 *
 * This exists because the app deploys to a subpath: `ng build --base-href
 * /flashcard/` stamps `<base href="/flashcard/">` into `index.html`, and a
 * hand-written `/hanzi/mmah.json` would then resolve to
 * `dimfel.github.io/hanzi/mmah.json` and 404 — but only in production, which is
 * the worst place to find out.
 *
 * `document.baseURI` is read rather than injecting `APP_BASE_HREF`: that token
 * is not provided anywhere in this app, and Angular's fallback simply re-reads
 * the same `<base>` tag. Returning an absolute URL also keeps the service
 * worker's cache key predictable.
 *
 * @param path relative to the app root, with no leading slash — `'hanzi/mmah.json'`
 */
export function assetUrl(path: string): string {
  return new URL(path, document.baseURI).href;
}
