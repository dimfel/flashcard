import { Injectable, signal } from '@angular/core';
import { assetUrl } from '../assets/asset-url';
import { parseCorpus, searchCorpus, type ExampleSentence } from './corpus';

const CORPUS_PATH = 'corpus/cmn-eng.tsv';

/** Roughly what the file weighs, for the "downloads once" label on the button. */
export const CORPUS_DOWNLOAD_LABEL = '2.5 MB';

export type CorpusStatus = 'idle' | 'loading' | 'ready' | 'error';

/**
 * Tatoeba example sentences, fetched once and searched in memory.
 *
 * A thin shell: everything interesting lives in the pure functions next door.
 * The download is deliberately not eager — a user who never opens the sentence
 * picker never pays for it, and `ngsw-config.json` caches it lazily to match.
 */
@Injectable({ providedIn: 'root' })
export class ExampleSentenceService {
  private lines: string[] = [];
  private inFlight?: Promise<void>;

  readonly status = signal<CorpusStatus>('idle');

  /** Downloads the corpus if it isn't already here. Safe to call repeatedly. */
  async load(): Promise<void> {
    this.inFlight ??= this.fetchCorpus().then(
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

  /** Sentences containing `term`. Empty until `load()` has resolved. */
  search(term: string, limit?: number): ExampleSentence[] {
    return searchCorpus(this.lines, term, limit);
  }

  private async fetchCorpus(): Promise<void> {
    this.status.set('loading');

    const response = await fetch(assetUrl(CORPUS_PATH));
    if (!response.ok) {
      throw new Error(`Corpus responded ${String(response.status)}`);
    }
    this.lines = parseCorpus(await response.text());
  }
}
