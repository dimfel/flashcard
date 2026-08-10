import { Injectable, signal } from '@angular/core';
import { assetUrl } from '../assets/asset-url';
import { lookupDefinition, parseDictionary, type Dictionary } from './dictionary';

const DICTIONARY_PATH = 'dictionary/cedict.tsv';

/** Roughly what the file weighs, for a "downloads once" label if one is needed. */
export const DICTIONARY_DOWNLOAD_LABEL = '5.9 MB';

export type DictionaryStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * CC-CEDICT definitions, fetched once and looked up in memory.
 *
 * A thin shell around the pure functions next door — same shape as
 * `ExampleSentenceService`, and the same reasoning: the download is not eager,
 * `ngsw-config.json` caches it lazily, and a user who never fills in field 4
 * never pays for it.
 */
@Injectable({ providedIn: 'root' })
export class DefinitionService {
  private dictionary: Dictionary = new Map();
  private inFlight?: Promise<void>;

  readonly status = signal<DictionaryStatus>('idle');

  /** Downloads the dictionary if it isn't already here. Safe to call repeatedly. */
  async load(): Promise<void> {
    this.inFlight ??= this.fetchDictionary().then(
      () => {
        this.status.set('ready');
      },
      () => {
        this.status.set('error');
        // Cleared so a later attempt can retry: the usual cause is being
        // offline on first use.
        this.inFlight = undefined;
      },
    );

    return this.inFlight;
  }

  /** The definition for `term`, or `null`. Always `null` until `load()` resolves. */
  lookup(term: string): string | null {
    return lookupDefinition(this.dictionary, term);
  }

  private async fetchDictionary(): Promise<void> {
    this.status.set('loading');

    const response = await fetch(assetUrl(DICTIONARY_PATH));
    if (!response.ok) {
      throw new Error(`Dictionary responded ${String(response.status)}`);
    }
    this.dictionary = parseDictionary(await response.text());
  }
}
