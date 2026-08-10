import { InjectionToken } from '@angular/core';
import { getDb, FlashcardDb } from './flashcard-db';

/**
 * The database, injected rather than imported directly, so a test can swap in a
 * throwaway `FlashcardDb` with its own name instead of sharing app state.
 */
export const FLASHCARD_DB = new InjectionToken<FlashcardDb>('FLASHCARD_DB', {
  providedIn: 'root',
  factory: () => getDb(),
});
