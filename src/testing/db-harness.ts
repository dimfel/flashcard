/**
 * Test harness giving each spec its own real Dexie database on top of
 * fake-indexeddb, so persistence is genuinely exercised rather than mocked
 * away — the bugs worth catching in this app live in the read-back path.
 */

import 'fake-indexeddb/auto';
import { FLASHCARD_DB } from '../app/core/db/db.token';
import { FlashcardDb } from '../app/core/db/flashcard-db';
import type { Deck } from '../app/core/models/card.types';

let counter = 0;

/** A fresh, uniquely named database. Call inside `beforeEach`. */
export function freshDb(): FlashcardDb {
  return new FlashcardDb(`flashcard-test-${counter++}`);
}

/** Registers the database with TestBed so injected stores use it. */
export function provideTestDb(db: FlashcardDb) {
  return { provide: FLASHCARD_DB, useValue: db };
}

/**
 * Tears a test database down. Yields to the microtask queue first so any Dexie
 * work a component kicked off during teardown settles against a live database —
 * otherwise it rejects with DatabaseClosedError as unhandled noise.
 */
export async function closeDb(db: FlashcardDb): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  db.close();
  await db.delete();
}

export function makeDeck(overrides: Partial<Deck> = {}): Deck {
  return {
    id: 'deck-1',
    name: 'Chinese — Reading',
    language: 'zh-Hans',
    productionEnabled: true,
    createdAt: Date.now(),
    ...overrides,
  };
}
