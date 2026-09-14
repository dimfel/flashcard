import { signal } from '@angular/core';
import { assetUrl } from '../../core/assets/asset-url';
import type {
  HandwritingRecognizer,
  RecognizerStatus,
  Stroke,
} from './handwriting.types';
import type { HanziLookupApi, HanziLookupMatcher } from './vendor/hanzilookup.min';

/** Name the decoded database is filed under inside the library. */
const DATA_NAME = 'mmah';
const DATA_PATH = 'hanzi/mmah.json';

/**
 * Handwriting recognition backed by the vendored HanziLookupJS.
 *
 * Neither the 12 kB library nor the 827 kB stroke database is touched until
 * `load()` is called, which happens when the user first opens the pad. Both are
 * cached by the service worker afterwards, so the second use is offline.
 */
export class HanziLookupRecognizer implements HandwritingRecognizer {
  private readonly state = signal<RecognizerStatus>('idle');
  readonly status = this.state.asReadonly();

  private library?: HanziLookupApi;
  private matcher?: HanziLookupMatcher;
  /** In-flight or completed load, so concurrent callers share one download. */
  private loading?: Promise<boolean>;

  load(): Promise<boolean> {
    this.loading ??= this.loadOnce().then(
      () => {
        this.state.set('ready');
        return true;
      },
      () => {
        this.state.set('unavailable');
        // Cleared so a later attempt can retry — the usual cause is being
        // offline on first use, which the next attempt may not be.
        this.loading = undefined;
        return false;
      },
    );

    return this.loading;
  }

  async lookup(strokes: readonly Stroke[], limit = 8): Promise<string[]> {
    if (strokes.length === 0) {
      return [];
    }
    if (!(await this.load())) {
      return [];
    }

    const library = this.library;
    const matcher = this.matcher;
    if (!library || !matcher) {
      return [];
    }

    // The library normalises by bounding box internally, so raw CSS-pixel
    // coordinates are correct input and the canvas can be any size.
    const analyzed = new library.AnalyzedCharacter(
      strokes.map((stroke) => stroke.map(([x, y]) => [x, y])),
    );

    return new Promise((resolve) => {
      matcher.match(analyzed, limit, (matches) =>
        resolve(matches.map((match) => match.character)),
      );
    });
  }

  private async loadOnce(): Promise<void> {
    this.state.set('loading');

    const library = (await import('./vendor/hanzilookup.min.js')).default;
    const response = await fetch(assetUrl(DATA_PATH));
    if (!response.ok) {
      throw new Error(`Stroke data responded ${String(response.status)}`);
    }

    // What `HanziLookup.init()`'s XHR callback does, minus the XHR — see the
    // README beside the vendored file.
    const data = (await response.json()) as { substrokes: string };
    library.data[DATA_NAME] = {
      ...data,
      substrokes: library.decodeCompact(data.substrokes),
    } as HanziLookupApi['data'][string];

    this.library = library;
    // Default looseness on purpose: measured against 口 and 十, widening it never
    // rescues wrong stroke order and pushes joined-stroke matches out of the top 8.
    this.matcher = new library.Matcher(DATA_NAME);
  }
}
