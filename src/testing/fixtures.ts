/**
 * Shared test fixtures.
 *
 * Deliberately separate from `db-harness.ts`: that module imports
 * `fake-indexeddb/auto` for its side effect, and the pure specs (backup
 * serialisation, scheduling) must stay free of a database they never touch.
 * Every spec that needs a card builds it here, so a change to the card shape is
 * a one-line edit rather than a sweep across specs.
 *
 * Every import below is `import type` on purpose. A value import would reach
 * `card.store` → `db.token` → `flashcard-db`, whose module-level `new
 * FlashcardDb()` captures `globalThis.indexedDB` at construction — and in a
 * spec that never touches the database, that construction would happen before
 * `fake-indexeddb/auto` has installed it, poisoning every later spec in the
 * bundle with `MissingAPIError`.
 */

import type { CardDraft } from '../app/core/state/card.store';
import type { Card, Deck } from '../app/core/models/card.types';

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

/**
 * A fully populated stored card. Timestamps are fixed rather than `Date.now()`
 * so backup round-trips can compare by value.
 */
export function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: 'card-1',
    deckId: 'deck-1',
    term: '顽固',
    sentence: '他顽固地拒绝了所有建议。',
    reading: 'wán gù',
    meaning: 'stubborn, obstinate',
    sentenceTranslation: 'He stubbornly rejected every suggestion.',
    tags: ['hsk6', 'reading'],
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_500_000,
    ...overrides,
  };
}

/**
 * The authored half of {@link makeCard}, for driving the editor and CardStore.
 * Spelled out rather than spread over `emptyDraft()` to keep this module free
 * of value imports — see the note at the top of the file.
 */
export function makeDraft(overrides: Partial<CardDraft> = {}): CardDraft {
  return {
    term: '顽固',
    sentence: '他顽固地拒绝了所有建议。',
    reading: '',
    meaning: '',
    sentenceTranslation: '',
    tags: [],
    ...overrides,
  };
}
