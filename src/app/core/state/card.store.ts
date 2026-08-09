import { computed, inject, Injectable, signal } from '@angular/core';
import { FLASHCARD_DB } from '../db/db.token';
import { deleteCardCascade, directionsFor } from '../db/queries';
import { emptyUsageNote, type Card, type Deck, type UsageNote } from '../models/card.types';
import { newSchedulingRows } from '../review/scheduler';

/** The authored part of a card — what the editor collects. */
export interface CardDraft {
  term: string;
  sentence: string;
  usage: UsageNote;
  reading?: string;
  meaning?: string;
  sentenceTranslation?: string;
  tags: string[];
}

export function emptyDraft(): CardDraft {
  return {
    term: '',
    sentence: '',
    usage: emptyUsageNote(),
    reading: '',
    meaning: '',
    sentenceTranslation: '',
    tags: [],
  };
}

@Injectable({ providedIn: 'root' })
export class CardStore {
  private readonly db = inject(FLASHCARD_DB);

  readonly cards = signal<Card[]>([]);
  readonly loading = signal(false);
  readonly search = signal('');

  /**
   * Client-side filtering: a personal deck is thousands of cards, not millions,
   * so filtering in memory keeps the browse screen instant and avoids paying for
   * an index we'd otherwise have to keep in sync.
   */
  readonly visible = computed(() => {
    const query = this.search().trim().toLowerCase();
    if (!query) {
      return this.cards();
    }
    return this.cards().filter((card) => this.matches(card, query));
  });

  async load(deckId: string): Promise<void> {
    this.loading.set(true);
    try {
      const cards = await this.db.cards.where('deckId').equals(deckId).toArray();
      cards.sort((a, b) => b.updatedAt - a.updatedAt);
      this.cards.set(cards);
    } finally {
      this.loading.set(false);
    }
  }

  async get(cardId: string): Promise<Card | undefined> {
    return this.db.cards.get(cardId);
  }

  /**
   * Creates a card and seeds its scheduling rows in the same transaction — a
   * card without scheduling would never appear in a review and would be
   * invisible to the point of the app.
   */
  async create(deck: Deck, draft: CardDraft): Promise<Card> {
    const now = Date.now();
    const card: Card = {
      id: crypto.randomUUID(),
      deckId: deck.id,
      ...normalise(draft),
      createdAt: now,
      updatedAt: now,
    };
    const rows = newSchedulingRows(card.id, directionsFor(deck.productionEnabled));

    await this.db.transaction('rw', this.db.cards, this.db.scheduling, async () => {
      await this.db.cards.put(card);
      await this.db.scheduling.bulkPut(rows);
    });

    return card;
  }

  async update(cardId: string, draft: CardDraft): Promise<void> {
    await this.db.cards.update(cardId, { ...normalise(draft), updatedAt: Date.now() });
  }

  async remove(cardId: string): Promise<void> {
    await deleteCardCascade(this.db, cardId);
    this.cards.update((cards) => cards.filter((card) => card.id !== cardId));
  }

  private matches(card: Card, query: string): boolean {
    const haystack = [
      card.term,
      card.sentence,
      card.reading,
      card.meaning,
      card.usage.note,
      ...card.usage.collocations,
      ...card.usage.contrasts.flatMap((contrast) => [contrast.with, contrast.note]),
      ...card.tags,
    ];
    return haystack.some((value) => value?.toLowerCase().includes(query));
  }
}

/** Trims authored text and drops empty optional fields so they stay `undefined`. */
function normalise(draft: CardDraft) {
  return {
    term: draft.term.trim(),
    sentence: draft.sentence.trim(),
    reading: blankToUndefined(draft.reading),
    meaning: blankToUndefined(draft.meaning),
    sentenceTranslation: blankToUndefined(draft.sentenceTranslation),
    tags: draft.tags.map((tag) => tag.trim()).filter(Boolean),
    usage: {
      note: draft.usage.note.trim(),
      register: draft.usage.register,
      collocations: draft.usage.collocations.map((c) => c.trim()).filter(Boolean),
      contrasts: draft.usage.contrasts
        .map((contrast) => ({ with: contrast.with.trim(), note: contrast.note.trim() }))
        .filter((contrast) => contrast.with || contrast.note),
    } satisfies UsageNote,
  };
}

function blankToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
