import { Injectable, signal } from '@angular/core';

/** One character of the term that has more than one reading. */
export interface PinyinAlternate {
  /** Index of the character within the term. */
  index: number;
  char: string;
  /** Every reading for that character, the derived one first. */
  options: readonly string[];
}

/**
 * Derives pinyin for a term.
 *
 * `pinyin-pro` ships both a per-character and a phrase dictionary, ~560 kB of
 * ESM before minification. That is far too much to sit in the initial bundle of
 * an app whose deck list, review and stats screens never need it, so the module
 * is pulled in on first use and the promise cached. `typeof import(...)` below
 * is a type-position import and emits nothing at runtime — the only emitted
 * import is the dynamic one inside `load()`.
 */
@Injectable({ providedIn: 'root' })
export class PinyinService {
  private module?: Promise<typeof import('pinyin-pro')>;

  /** True once the dictionary chunk has arrived. */
  readonly ready = signal(false);

  /**
   * Tone-marked pinyin for a whole term, e.g. '顽固' → 'wán gù'.
   *
   * Converts the term in one call rather than character by character on
   * purpose: pinyin-pro segments the input, which is what resolves 多音字 from
   * context — 银行 gives 'yín háng' and 行走 gives 'xíng zǒu'. Feeding it single
   * characters would throw that away and pick the most common reading instead.
   */
  async convert(term: string): Promise<string> {
    const trimmed = term.trim();
    if (!trimmed) {
      return '';
    }

    const { pinyin } = await this.load();
    // `nonZh: 'consecutive'` keeps any Latin text intact; the default spaces
    // every character out, turning 'OK' into 'O K'.
    return pinyin(trimmed, { toneType: 'symbol', nonZh: 'consecutive' });
  }

  /**
   * The characters in `term` that have more than one reading, so the editor can
   * offer them. Empty when the term is unambiguous, which is the common case.
   */
  async alternates(term: string): Promise<PinyinAlternate[]> {
    const trimmed = term.trim();
    if (!trimmed) {
      return [];
    }

    const { pinyin } = await this.load();
    const perCharacter = pinyin(trimmed, { type: 'all', nonZh: 'consecutive' });

    return perCharacter.flatMap((entry, index) => {
      if (!entry.isZh || entry.polyphonic.length < 2) {
        return [];
      }
      // The contextually chosen reading leads, then the rest in dictionary order.
      const rest = entry.polyphonic.filter((option) => option !== entry.result);
      return [{ index, char: entry.origin, options: [entry.result, ...rest] }];
    });
  }

  private load(): Promise<typeof import('pinyin-pro')> {
    this.module ??= import('pinyin-pro').then((module) => {
      this.ready.set(true);
      return module;
    });
    return this.module;
  }
}
