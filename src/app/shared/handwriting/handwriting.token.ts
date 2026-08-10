import { InjectionToken } from '@angular/core';
import { HanziLookupRecognizer } from './hanzi-lookup-recognizer';
import type { HandwritingRecognizer } from './handwriting.types';

/**
 * The recogniser, injected rather than constructed, so a spec can supply a fake
 * instead of a jsdom environment that has neither `fetch` nor a stroke database.
 * Mirrors `FLASHCARD_DB` in `core/db/db.token.ts`.
 */
export const HANDWRITING_RECOGNIZER = new InjectionToken<HandwritingRecognizer>(
  'HANDWRITING_RECOGNIZER',
  {
    providedIn: 'root',
    factory: () => new HanziLookupRecognizer(),
  },
);
