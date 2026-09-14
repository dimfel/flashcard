import { signal } from '@angular/core';
import type {
  HandwritingRecognizer,
  RecognizerStatus,
  Stroke,
  WritingArea,
} from './handwriting.types';

const ENDPOINT = 'https://inputtools.google.com/request?ime=handwriting&app=deckcard&cs=1&oe=UTF-8';
const TIMEOUT_MS = 2500;
/** The API mixes punctuation in with characters (一 comes back alongside "-" and "_"). */
const HAN = /^\p{Script=Han}+$/u;

/**
 * Online recognition through Google Input Tools' handwriting endpoint.
 *
 * Unlike HanziLookup it is not thrown by stroke order or joined strokes, which is
 * why it is preferred whenever there is a connection. The endpoint is
 * undocumented, so every failure throws and `CompositeRecognizer` falls back.
 */
export class GoogleInputRecognizer implements HandwritingRecognizer {
  readonly status = signal<RecognizerStatus>('ready').asReadonly();

  async load(): Promise<boolean> {
    return true;
  }

  async lookup(strokes: readonly Stroke[], limit = 8, area?: WritingArea): Promise<string[]> {
    if (strokes.length === 0) {
      return [];
    }

    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody(strokes, area)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Handwriting service responded ${String(response.status)}`);
    }

    return parseCandidates(await response.json()).slice(0, limit);
  }
}

export function requestBody(strokes: readonly Stroke[], area?: WritingArea) {
  return {
    requests: [
      {
        writing_guide: {
          writing_area_width: Math.round(area?.width ?? 0),
          writing_area_height: Math.round(area?.height ?? 0),
        },
        // Timestamps are optional; the service accepts an empty third array.
        ink: strokes.map((stroke) => [
          stroke.map(([x]) => Math.round(x)),
          stroke.map(([, y]) => Math.round(y)),
          [],
        ]),
        language: 'zh_CN',
      },
    ],
  };
}

/** `["SUCCESS", [[id, candidates, ...]]]` → Han-only candidates. Throws on anything else. */
export function parseCandidates(payload: unknown): string[] {
  if (!Array.isArray(payload) || payload[0] !== 'SUCCESS') {
    throw new Error('Handwriting service did not succeed.');
  }
  const candidates: unknown = payload[1]?.[0]?.[1];
  if (!Array.isArray(candidates)) {
    throw new Error('Handwriting service returned an unexpected shape.');
  }
  return candidates.filter((value): value is string => typeof value === 'string' && HAN.test(value));
}
