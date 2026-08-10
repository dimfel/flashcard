/**
 * Test harness giving each spec its own real Dexie database on top of
 * fake-indexeddb, so persistence is genuinely exercised rather than mocked
 * away — the bugs worth catching in this app live in the read-back path.
 */

// `fake-indexeddb` is installed by `vitest-setup.ts`, which runs before any
// spec module — see the note there for why it cannot live in an import here.
import { FLASHCARD_DB } from '../app/core/db/db.token';
import { FlashcardDb } from '../app/core/db/flashcard-db';

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

// Card, deck and draft factories live in `./fixtures` so the pure specs can use
// them without dragging in fake-indexeddb.
