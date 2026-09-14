import { computed, signal } from '@angular/core';
import type {
  HandwritingRecognizer,
  RecognizerStatus,
  Stroke,
  WritingArea,
} from './handwriting.types';

/**
 * Online recognition when connected, the bundled offline matcher otherwise.
 *
 * The offline database still downloads in the background on `load()`, so the
 * fallback is ready by the time the connection drops.
 */
export class CompositeRecognizer implements HandwritingRecognizer {
  private readonly connected = signal(isOnline());

  /**
   * Reported `ready` while online even if the offline data never loaded — the pad
   * hides candidates when status is `unavailable`, which would bury good online
   * results behind an irrelevant download failure.
   */
  readonly status = computed<RecognizerStatus>(() =>
    this.connected() ? 'ready' : this.offline.status(),
  );

  constructor(
    private readonly online: HandwritingRecognizer,
    private readonly offline: HandwritingRecognizer,
  ) {
    globalThis.addEventListener?.('online', () => this.connected.set(true));
    globalThis.addEventListener?.('offline', () => this.connected.set(false));
  }

  load(): Promise<boolean> {
    const offlineReady = this.offline.load();
    return this.refreshConnected() ? Promise.resolve(true) : offlineReady;
  }

  async lookup(strokes: readonly Stroke[], limit?: number, area?: WritingArea): Promise<string[]> {
    if (this.refreshConnected()) {
      try {
        const matches = await this.online.lookup(strokes, limit, area);
        if (matches.length > 0) {
          return matches;
        }
      } catch {
        // Fall through to the offline matcher.
      }
    }
    return this.offline.lookup(strokes, limit, area);
  }

  private refreshConnected(): boolean {
    const online = isOnline();
    this.connected.set(online);
    return online;
  }
}

function isOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
