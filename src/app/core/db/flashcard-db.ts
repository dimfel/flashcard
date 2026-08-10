/**
 * IndexedDB access via Dexie.
 *
 * Deliberately NOT using Dexie's `liveQuery`/observables: this app has one
 * reactivity model (signals), and stores reload explicitly after writes. Mixing
 * in RxJS here would buy convenience at the cost of two ways to do everything.
 */

import Dexie, { type EntityTable } from 'dexie';
import {
  DEFAULT_SETTINGS,
  SETTINGS_ID,
  type Card,
  type Deck,
  type ReviewLog,
  type Scheduling,
  type Settings,
} from '../models/card.types';

export class FlashcardDb extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  scheduling!: EntityTable<Scheduling, 'cardId'>;
  reviewLogs!: EntityTable<ReviewLog, 'id'>;
  settings!: EntityTable<Settings, 'id'>;

  constructor(name = 'flashcard-db') {
    super(name);

    // `due` on scheduling is the load-bearing index: the entire review queue is
    // one range query over it, which is what keeps this fast at 10k+ cards.
    this.version(1).stores({
      decks: 'id, name',
      cards: 'id, deckId, term, updatedAt, *tags',
      scheduling: '[cardId+direction], due, cardId, [cardId+due]',
      reviewLogs: 'id, cardId, reviewedAt',
      settings: 'id',
    });

    // v2 drops the structured `usage` note (field 3 became pinyin). The schema
    // is unchanged — `usage` was never indexed — so this version exists purely
    // to carry the data migration. The store map is repeated rather than left
    // empty so this block reads as the current truth; identical schemas are a
    // no-op to Dexie.
    this.version(2)
      .stores({
        decks: 'id, name',
        cards: 'id, deckId, term, updatedAt, *tags',
        scheduling: '[cardId+direction], due, cardId, [cardId+due]',
        reviewLogs: 'id, cardId, reviewedAt',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table('cards')
          .toCollection()
          .modify((card: Record<string, unknown>) => {
            delete card['usage'];
          });
      });
  }

  /** Reads settings, seeding defaults on first run. */
  async getSettings(): Promise<Settings> {
    const existing = await this.settings.get(SETTINGS_ID);
    if (existing) {
      return existing;
    }
    await this.settings.put(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }

  /** Wipes every table. Used by import-replace and by tests. */
  async clearAll(): Promise<void> {
    await this.transaction(
      'rw',
      this.decks,
      this.cards,
      this.scheduling,
      this.reviewLogs,
      this.settings,
      async () => {
        await Promise.all([
          this.decks.clear(),
          this.cards.clear(),
          this.scheduling.clear(),
          this.reviewLogs.clear(),
          this.settings.clear(),
        ]);
      },
    );
  }
}

let instance: FlashcardDb | undefined;

/**
 * The app-wide instance, created on first request rather than at module load.
 *
 * Laziness is load-bearing in tests: Dexie captures `globalThis.indexedDB` in
 * its constructor, and the specs install `fake-indexeddb` via a side-effect
 * import. A module-level `new FlashcardDb()` would run whenever the bundler
 * happened to evaluate this module — which for a spec that never touches the
 * database can be before that shim is in place, poisoning every later spec with
 * `MissingAPIError`. Tests construct their own `FlashcardDb` and never call this.
 */
export function getDb(): FlashcardDb {
  return (instance ??= new FlashcardDb());
}
