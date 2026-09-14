/**
 * The handwriting seam.
 *
 * Deliberately free of imports so the pad component, the real recogniser and
 * test fakes can all depend on it without a cycle — the same split as
 * `core/db/flashcard-db.ts` and `core/db/db.token.ts`.
 */

import type { Signal } from '@angular/core';

/** A point in CSS pixels, relative to the canvas. */
export type StrokePoint = readonly [number, number];

/** One pen-down to pen-up movement. */
export type Stroke = readonly StrokePoint[];

export type RecognizerStatus =
  /** Nothing loaded yet; nothing downloaded. */
  | 'idle'
  /** Fetching the stroke database. */
  | 'loading'
  /** Loaded and able to match. */
  | 'ready'
  /** Load failed — almost always first use while offline. */
  | 'unavailable';

/** The drawing surface in CSS pixels. Some recognisers scale strokes against it. */
export interface WritingArea {
  width: number;
  height: number;
}

export interface HandwritingRecognizer {
  readonly status: Signal<RecognizerStatus>;

  /** Downloads and decodes the stroke database. Safe to call repeatedly. */
  load(): Promise<boolean>;

  /** Candidate characters for `strokes`, best first. Empty if not loaded. */
  lookup(strokes: readonly Stroke[], limit?: number, area?: WritingArea): Promise<string[]>;
}
