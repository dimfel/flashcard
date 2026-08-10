/**
 * CC-CEDICT dictionary: parsing and lookup.
 *
 * Pure and dependency-free, same reasoning as `core/corpus/corpus.ts`: the
 * interesting logic is testable without a network or a multi-megabyte fixture.
 *
 * The file is one tab-separated line per term, `term\tdefinition`, sorted by
 * term by `scripts/build-dictionary.mjs`. Unlike the example-sentence corpus
 * this is exact-term lookup, not substring search, so the natural structure is
 * a `Map` rather than a scanned array — one lookup per keystroke should be O(1),
 * not a walk over 117k lines.
 */

/** term -> definition */
export type Dictionary = ReadonlyMap<string, string>;

/** Splits the raw file into a term-keyed map, tolerating CRLF and blank lines. */
export function parseDictionary(text: string): Dictionary {
  const entries = new Map<string, string>();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (!line) {
      continue;
    }

    const tab = line.indexOf('\t');
    if (tab < 0) {
      continue;
    }

    entries.set(line.slice(0, tab), line.slice(tab + 1));
  }

  return entries;
}

/** The definition for `term`, or `null` if the dictionary has nothing. */
export function lookupDefinition(dictionary: Dictionary, term: string): string | null {
  const trimmed = term.trim();
  if (!trimmed) {
    return null;
  }
  return dictionary.get(trimmed) ?? null;
}
