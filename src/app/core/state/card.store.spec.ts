import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { State } from 'ts-fsrs';
import { closeDb, freshDb, makeDeck, provideTestDb } from '../../../testing/db-harness';
import type { FlashcardDb } from '../db/flashcard-db';
import { CardStore, emptyDraft, type CardDraft } from './card.store';

function draft(overrides: Partial<CardDraft> = {}): CardDraft {
  return {
    ...emptyDraft(),
    term: '顽固',
    sentence: '他顽固地拒绝了所有建议。',
    usage: {
      note: 'Almost always pejorative.',
      register: 'formal',
      collocations: ['顽固不化'],
      contrasts: [{ with: '固执', note: '固执 can be neutral.' }],
    },
    ...overrides,
  };
}

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

  it('drops empty collocations and contrasts rather than storing blanks', async () => {
    const card = await store.create(
      makeDeck(),
      draft({
        usage: {
          note: 'kept',
          collocations: ['顽固不化', '  ', ''],
          contrasts: [
            { with: '固执', note: 'differs' },
            { with: '  ', note: '  ' },
          ],
        },
      }),
    );

    const stored = await db.cards.get(card.id);

    expect(stored?.usage.collocations).toEqual(['顽固不化']);
    expect(stored?.usage.contrasts).toEqual([{ with: '固执', note: 'differs' }]);
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
          usage: { note: 'Intransitive.', collocations: ['发生事故'], contrasts: [] },
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

    it('matches on collocations and tags, not just the headword', () => {
      store.search.set('事故');
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
