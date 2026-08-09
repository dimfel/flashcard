import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Rating, State } from 'ts-fsrs';
import { closeDb, freshDb, makeDeck, provideTestDb } from '../../../testing/db-harness';
import type { FlashcardDb } from '../db/flashcard-db';
import { BLANK } from '../review/scheduler';
import { CardStore, emptyDraft } from './card.store';
import { ReviewSessionStore } from './review-session.store';
import { SettingsStore } from './settings.store';

describe('ReviewSessionStore', () => {
  let db: FlashcardDb;
  let session: ReviewSessionStore;
  let cards: CardStore;
  let settings: SettingsStore;

  const deck = makeDeck({ productionEnabled: true });

  beforeEach(async () => {
    db = freshDb();
    TestBed.configureTestingModule({ providers: [provideTestDb(db)] });
    session = TestBed.inject(ReviewSessionStore);
    cards = TestBed.inject(CardStore);
    settings = TestBed.inject(SettingsStore);

    await db.decks.put(deck);
    await cards.create(deck, {
      ...emptyDraft(),
      term: '顽固',
      sentence: '他顽固地拒绝了。',
      meaning: 'stubborn',
      usage: { note: 'Pejorative.', collocations: [], contrasts: [] },
    });
  });

  afterEach(async () => {
    await closeDb(db);
  });

  it('queues both directions of a production-enabled deck', async () => {
    await session.start(deck);

    expect(session.remaining()).toBe(2);
  });

  it('blanks the term for the production prompt and shows it plainly for recognition', async () => {
    await session.start(deck);

    const directions = session.queue().map((row) => row.direction);
    const production = directions.indexOf('production');
    // Walk to whichever card is the production one and read its prompt.
    for (let i = 0; i < production; i++) {
      session.reveal();
      await session.applyGrade(Rating.Easy);
    }

    expect(session.prompt()).toBe(`他${BLANK}地拒绝了。`);
  });

  it('persists a grade to both scheduling and the log', async () => {
    await session.start(deck);
    const first = session.current()!;

    session.reveal();
    await session.applyGrade(Rating.Good);

    const stored = await db.scheduling.get({
      cardId: first.card.id,
      direction: first.scheduling.direction,
    });
    expect(stored?.state).not.toBe(State.New);
    expect(await db.reviewLogs.count()).toBe(1);
  });

  it('re-hides the answer when advancing to the next card', async () => {
    await session.start(deck);
    session.reveal();
    expect(session.revealed()).toBe(true);

    await session.applyGrade(Rating.Good);

    expect(session.revealed()).toBe(false);
  });

  it('brings an Again card back within the same session', async () => {
    await session.start(deck);
    const first = session.current()!;

    session.reveal();
    await session.applyGrade(Rating.Again);

    const cardIds = session.queue().map((row) => `${row.cardId}::${row.direction}`);
    expect(cardIds).toContain(`${first.card.id}::${first.scheduling.direction}`);
  });

  it('does not requeue a card pushed days away', async () => {
    await session.start(deck);
    const first = session.current()!;

    session.reveal();
    await session.applyGrade(Rating.Easy);

    const stillQueued = session
      .queue()
      .some((row) => row.cardId === first.card.id && row.direction === first.scheduling.direction);
    expect(stillQueued).toBe(false);
  });

  it('undo restores the exact pre-grade scheduling row', async () => {
    await session.start(deck);
    const before = session.current()!.scheduling;

    session.reveal();
    await session.applyGrade(Rating.Easy);
    await session.undo();

    const restored = await db.scheduling.get({
      cardId: before.cardId,
      direction: before.direction,
    });
    expect(restored?.due).toBe(before.due);
    expect(restored?.state).toBe(State.New);
    expect(await db.reviewLogs.count()).toBe(0);
    expect(session.current()?.scheduling.cardId).toBe(before.cardId);
  });

  it('undo does not leave a duplicate behind after an Again requeue', async () => {
    await session.start(deck);
    const before = session.current()!.scheduling;

    session.reveal();
    await session.applyGrade(Rating.Again);
    await session.undo();

    const matching = session
      .queue()
      .filter((row) => row.cardId === before.cardId && row.direction === before.direction);
    expect(matching).toHaveLength(1);
  });

  it('undo is a no-op with nothing graded yet', async () => {
    await session.start(deck);

    await session.undo();

    expect(session.remaining()).toBe(2);
    expect(session.canUndo()).toBe(false);
  });

  it('honours the daily new-card cap', async () => {
    await settings.load();
    await settings.update({ newCardsPerDay: 1 });

    await session.start(deck);

    expect(session.remaining()).toBe(1);
  });

  it('reports finished when the deck has nothing due', async () => {
    const emptyDeck = makeDeck({ id: 'deck-empty', name: 'Empty' });
    await db.decks.put(emptyDeck);

    await session.start(emptyDeck);

    expect(session.finished()).toBe(true);
    expect(session.current()).toBeNull();
  });
});
