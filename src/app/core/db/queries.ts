/**
 * Queries shared by more than one store.
 *
 * The deck list's due badge and the review screen's queue must agree — if a deck
 * says "12 due" the session had better hand you 12 cards. Keeping the join in
 * one place is what guarantees that.
 */

import type { ReviewDirection, Scheduling } from '../models/card.types';
import { buildQueue, isNew } from '../review/scheduler';
import type { FlashcardDb } from './flashcard-db';

export interface QueueSummary {
  /** Cards already due for review. */
  due: number;
  /** Unseen cards that will be introduced today, after the daily cap. */
  fresh: number;
  /** What a session started right now would actually contain. */
  total: number;
}

/** Every scheduling row belonging to a deck. */
export async function schedulingForDeck(db: FlashcardDb, deckId: string): Promise<Scheduling[]> {
  const cardIds = (await db.cards.where('deckId').equals(deckId).primaryKeys()) as string[];
  if (cardIds.length === 0) {
    return [];
  }
  return db.scheduling.where('cardId').anyOf(cardIds).toArray();
}

/** What today's session for this deck looks like, without building it. */
export async function queueSummary(
  db: FlashcardDb,
  deckId: string,
  newCardsPerDay: number,
  now: number = Date.now(),
): Promise<QueueSummary> {
  const rows = await schedulingForDeck(db, deckId);
  const queue = buildQueue(rows, newCardsPerDay, now);
  const fresh = queue.filter(isNew).length;

  return { due: queue.length - fresh, fresh, total: queue.length };
}

/**
 * Deletes a card and everything hanging off it. Scheduling rows and logs are
 * useless without their card, and leaving them behind would inflate due counts
 * with cards that no longer exist.
 */
export async function deleteCardCascade(db: FlashcardDb, cardId: string): Promise<void> {
  await db.transaction('rw', db.cards, db.scheduling, db.reviewLogs, async () => {
    await db.cards.delete(cardId);
    await db.scheduling.where('cardId').equals(cardId).delete();
    await db.reviewLogs.where('cardId').equals(cardId).delete();
  });
}

/** Deletes a deck and every card inside it. */
export async function deleteDeckCascade(db: FlashcardDb, deckId: string): Promise<void> {
  const cardIds = (await db.cards.where('deckId').equals(deckId).primaryKeys()) as string[];

  await db.transaction('rw', db.decks, db.cards, db.scheduling, db.reviewLogs, async () => {
    await db.decks.delete(deckId);
    await db.cards.where('deckId').equals(deckId).delete();
    if (cardIds.length > 0) {
      await db.scheduling.where('cardId').anyOf(cardIds).delete();
      await db.reviewLogs.where('cardId').anyOf(cardIds).delete();
    }
  });
}

/** The directions a deck drills, used when seeding a new card's scheduling. */
export function directionsFor(productionEnabled: boolean): ReviewDirection[] {
  return productionEnabled ? ['recognition', 'production'] : ['recognition'];
}
