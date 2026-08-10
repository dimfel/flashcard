import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { State } from 'ts-fsrs';
import { closeDb, freshDb, provideTestDb } from '../../../testing/db-harness';
import { makeDeck, makeDraft as draft } from '../../../testing/fixtures';
import type { FlashcardDb } from '../db/flashcard-db';
import { CardStore } from './card.store';

describe('CardStore', () => {
  let db: FlashcardDb;
  let store: CardStore;

  beforeEach(() => {
    db = freshDb();
    TestBed.configureTestingModule({ providers: [provideTestDb(db)] });
    store = TestBed.inject(CardStore);
  });

  afterEach(async () => {
    await closeDb(db);
  });

  it('seeds two scheduling rows when the deck drills production', async () => {
    const card = await store.create(makeDeck({ productionEnabled: true }), draft());

    const rows = await db.scheduling.where('cardId').equals(card.id).toArray();

    expect(rows.map((row) => row.direction).sort()).toEqual(['production', 'recognition']);
    expect(rows.every((row) => row.state === State.New)).toBe(true);
  });

  it('seeds only recognition when production is off', async () => {
    const card = await store.create(makeDeck({ productionEnabled: false }), draft());

    const rows = await db.scheduling.where('cardId').equals(card.id).toArray();

    expect(rows.map((row) => row.direction)).toEqual(['recognition']);
  });

  it('trims authored text and drops blank optional fields', async () => {
    const card = await store.create(
      makeDeck(),
      draft({ term: '  顽固  ', reading: '   ', meaning: ' stubborn ' }),
    );

    const stored = await db.cards.get(card.id);

    expect(stored?.term).toBe('顽固');
    expect(stored?.reading).toBeUndefined();
    expect(stored?.meaning).toBe('stubborn');
  });

  it('drops blank tags rather than storing empties', async () => {
    const card = await store.create(makeDeck(), draft({ tags: ['hsk6', '  ', '', ' reading '] }));

    const stored = await db.cards.get(card.id);

    expect(stored?.tags).toEqual(['hsk6', 'reading']);
  });

  it('removes scheduling and logs along with the card', async () => {
    const card = await store.create(makeDeck(), draft());
    await store.load(makeDeck().id);

    await store.remove(card.id);

    expect(await db.cards.get(card.id)).toBeUndefined();
    expect(await db.scheduling.where('cardId').equals(card.id).count()).toBe(0);
    expect(store.cards()).toHaveLength(0);
  });

  it('lists newest-edited first', async () => {
    const deck = makeDeck();
    await store.create(deck, draft({ term: 'first' }));
    await store.create(deck, draft({ term: 'second' }));

    await store.load(deck.id);

    expect(store.cards()[0].term).toBe('second');
  });

  describe('search', () => {
    beforeEach(async () => {
      const deck = makeDeck();
      await store.create(deck, draft({ term: '顽固', meaning: 'stubborn' }));
      await store.create(
        deck,
        draft({
          term: '发生',
          sentence: '发生了什么？',
          meaning: 'to happen',
          sentenceTranslation: 'What happened?',
          tags: ['news'],
        }),
      );
      await store.load(deck.id);
    });

    it('matches on the term', () => {
      store.search.set('发生');
      expect(store.visible().map((card) => card.term)).toEqual(['发生']);
    });

    it('matches on the English meaning', () => {
      store.search.set('stubborn');
      expect(store.visible().map((card) => card.term)).toEqual(['顽固']);
    });

    it('matches on the sentence translation and tags, not just the headword', () => {
      store.search.set('what happened');
      expect(store.visible()).toHaveLength(1);

      store.search.set('news');
      expect(store.visible()).toHaveLength(1);
    });

    it('shows everything when the search is cleared', () => {
      store.search.set('   ');
      expect(store.visible()).toHaveLength(2);
    });
  });
});
