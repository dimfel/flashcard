/**
 * Example-sentence corpus: parsing and search.
 *
 * Pure and dependency-free so the interesting logic is testable without a
 * network or a 2.5 MB fixture. The service in this folder is a thin fetch shell
 * around these two functions.
 *
 * The corpus is one tab-separated line per pair, `chinese\tenglish`, sorted
 * shortest-first by `scripts/build-corpus.mjs`. TSV rather than JSON because
 * `split('\n')` on a multi-megabyte payload is far cheaper than `JSON.parse`,
 * and there is nothing here that needs quoting.
 */

export interface ExampleSentence {
  chinese: string;
  english: string;
}

/** Splits the raw file into lines, tolerating CRLF and trailing blanks. */
export function parseCorpus(text: string): string[] {
  return text
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0);
}

/**
 * Sentences whose Chinese half contains `term`, best (shortest) first.
 *
 * A linear scan over ~38k short strings runs in a couple of milliseconds, and
 * because the file is pre-sorted shortest-first the scan stops as soon as it
 * has `limit` hits — usually a few thousand lines in. An inverted index would
 * save a millisecond and cost a second asset plus a class of bugs.
 */
export function searchCorpus(
  lines: readonly string[],
  term: string,
  limit = 20,
): ExampleSentence[] {
  const needle = term.trim();
  const found: ExampleSentence[] = [];
  if (!needle || limit <= 0) {
    return found;
  }

  for (const line of lines) {
    const tab = line.indexOf('\t');
    if (tab < 0) {
      continue;
    }

    const at = line.indexOf(needle);
    // `at >= tab` means the hit is in the English gloss, not the sentence —
    // without this check a term like 'OK' matches its own translation.
    if (at < 0 || at >= tab) {
      continue;
    }

    found.push({ chinese: line.slice(0, tab), english: line.slice(tab + 1) });
    if (found.length >= limit) {
      break;
    }
  }

  return found;
}
