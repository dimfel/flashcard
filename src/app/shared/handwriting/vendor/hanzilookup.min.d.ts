/**
 * Hand-written types for the vendored `hanzilookup.min.js`.
 *
 * Covers only the surface `hanzi-lookup-recognizer.ts` uses. The library has a
 * wider API (DrawingBoard, StrokeInputOverlay, tuning constants); this app
 * draws its own canvas, so those are deliberately left untyped.
 */

/** A stroke is a list of `[x, y]` points, in any consistent unit. */
export type HanziLookupStrokes = number[][][];

export interface HanziLookupMatch {
  character: string;
  score: number;
}

export interface HanziLookupMatcher {
  match(
    character: object,
    limit: number,
    callback: (matches: HanziLookupMatch[]) => void,
  ): void;
}

/** One decoded stroke database, as `data[name]` holds it after decoding. */
export interface HanziLookupData {
  chars: unknown[];
  substrokes: unknown;
}

export interface HanziLookupApi {
  /** Decoded databases, keyed by the name passed to `new Matcher(name)`. */
  data: Record<string, HanziLookupData>;

  /**
   * Unpacks the base64 `substrokes` blob of a raw data file. The app calls this
   * itself rather than going through `init()`, which fetches over XHR.
   */
  decodeCompact(packed: string): unknown;

  /** Fetches and decodes a database over XMLHttpRequest. Unused — see above. */
  init(name: string, url: string, ready: (ok: boolean) => void): void;

  AnalyzedCharacter: new (strokes: HanziLookupStrokes) => object;
  Matcher: new (dataName: string, looseness?: number) => HanziLookupMatcher;
}

declare const HanziLookup: HanziLookupApi;
export default HanziLookup;
