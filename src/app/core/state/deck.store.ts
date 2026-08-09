import { inject, Injectable, signal } from '@angular/core';
import { FLASHCARD_DB } from '../db/db.token';
import { deleteDeckCascade, queueSummary, type QueueSummary } from '../db/queries';
import type { Deck } from '../models/card.types';
import { SettingsStore } from './settings.store';

export interface DeckWithQueue {
  deck: Deck;
  queue: QueueSummary;
  cardCount: number;
}

@Injectable({ providedIn: 'root' })
export class DeckStore {
  private readonly db = inject(FLASHCARD_DB);
  private readonly settingsStore = inject(SettingsStore);

  readonly decks = signal<DeckWithQueue[]>([]);
  readonly loading = signal(false);

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      if (!this.settingsStore.loaded()) {
        await this.settingsStore.load();
      }
      const cap = this.settingsStore.settings().newCardsPerDay;
      const decks = await this.db.decks.orderBy('name').toArray();

      this.decks.set(
        await Promise.all(
          decks.map(async (deck) => ({
            deck,
            queue: await queueSummary(this.db, deck.id, cap),
            cardCount: await this.db.cards.where('deckId').equals(deck.id).count(),
          })),
        ),
      );
    } finally {
      this.loading.set(false);
    }
  }

  async get(deckId: string): Promise<Deck | undefined> {
    return this.db.decks.get(deckId);
  }

  async create(name: string, language: string, productionEnabled: boolean): Promise<Deck> {
    const deck: Deck = {
      id: crypto.randomUUID(),
      name: name.trim(),
      language: language.trim() || 'zh-Hans',
      productionEnabled,
      createdAt: Date.now(),
    };
    await this.db.decks.put(deck);
    await this.load();
    return deck;
  }

  async update(deckId: string, patch: Partial<Omit<Deck, 'id'>>): Promise<void> {
    await this.db.decks.update(deckId, patch);
    await this.load();
  }

  async remove(deckId: string): Promise<void> {
    await deleteDeckCascade(this.db, deckId);
    await this.load();
  }
}
