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

/** The app-wide instance. Tests construct their own `FlashcardDb` instead. */
export const db = new FlashcardDb();
