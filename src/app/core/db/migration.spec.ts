/**
 * Schema migration and change-tracking tests.
 *
 * Migrations open a bare Dexie at the OLD version, write old-shaped rows, close,
 * and reopen through `FlashcardDb` so the upgrade path actually runs. Asserting
 * on the upgrade function directly would prove nothing: the bug worth catching
 * is a version block that never fires on a real database.
 */

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import type { Scheduling } from '../models/card.types';
import { FlashcardDb } from './flashcard-db';
import { deleteCardCascade } from './queries';

let counter = 0;
let opened: (Dexie | FlashcardDb)[] = [];

const LEGACY_STORES = {
  decks: 'id, name',
  cards: 'id, deckId, term, updatedAt, *tags',
  scheduling: '[cardId+direction], due, cardId, [cardId+due]',
  reviewLogs: 'id, cardId, reviewedAt',
  settings: 'id',
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A v1 database, exactly as it was before field 3 became pinyin. */
function openV1(name: string): Dexie {
  const legacy = new Dexie(name);
  legacy.version(1).stores(LEGACY_STORES);
  opened.push(legacy);
  return legacy;
}

/** A v3 database — with the auto-backup handles store, before sync. */
function openV3(name: string): Dexie {
  const legacy = new Dexie(name);
  legacy.version(1).stores(LEGACY_STORES);
  legacy.version(2).stores(LEGACY_STORES);
  legacy.version(3).stores({ ...LEGACY_STORES, handles: 'id' });
  opened.push(legacy);
  return legacy;
}

function freshDb(): FlashcardDb {
  const db = new FlashcardDb(`flashcard-migration-${counter++}`);
  opened.push(db);
  return db;
}

function schedulingRow(cardId: string, direction: Scheduling['direction']): Scheduling {
  return {
    cardId,
    direction,
    due: 1,
    state: 0,
    fsrs: { due: new Date(1), reps: 0 } as Scheduling['fsrs'],
  };
}

afterEach(async () => {
  for (const db of opened) {
    db.close();
    await db.delete();
  }
  opened = [];
});

describe('v1 → v2 upgrade', () => {
  it('drops the structured usage note, keeping everything else on the card', async () => {
    const name = `flashcard-migration-${counter++}`;

    const legacy = openV1(name);
    await legacy.table('cards').put({
      id: 'card-1',
      deckId: 'deck-1',
      term: '顽固',
      sentence: '他顽固地拒绝了所有建议。',
      usage: {
        note: '书面语气偏重，多含贬义。',
        register: 'formal',
        collocations: ['顽固不化'],
        contrasts: [{ with: '固执', note: '固执可中性。' }],
      },
      reading: 'wán gù',
      meaning: 'stubborn, obstinate',
      tags: ['hsk6'],
      createdAt: 1,
      updatedAt: 2,
    });
    legacy.close();

    const upgraded = new FlashcardDb(name);
    opened.push(upgraded);
    const card = await upgraded.cards.get('card-1');

    expect(card).not.toHaveProperty('usage');
    expect(card?.term).toBe('顽固');
    expect(card?.reading).toBe('wán gù');
    expect(card?.meaning).toBe('stubborn, obstinate');
    expect(card?.tags).toEqual(['hsk6']);
  });

  it('leaves a card that never had a usage note untouched', async () => {
    const name = `flashcard-migration-${counter++}`;

    const legacy = openV1(name);
    await legacy.table('cards').put({
      id: 'card-2',
      deckId: 'deck-1',
      term: '发生',
      sentence: '发生了什么？',
      tags: [],
      createdAt: 1,
      updatedAt: 2,
    });
    legacy.close();

    const upgraded = new FlashcardDb(name);
    opened.push(upgraded);

    expect(await upgraded.cards.get('card-2')).toMatchObject({ term: '发生', tags: [] });
  });

  it('scheduling rows survive the upgrade, so review history is not reset', async () => {
    const name = `flashcard-migration-${counter++}`;

    const legacy = openV1(name);
    await legacy.table('scheduling').put({
      cardId: 'card-1',
      direction: 'recognition',
      due: 1_700_000_000_000,
      state: 2,
      fsrs: { due: new Date(1_700_000_000_000), reps: 7 },
    });
    legacy.close();

    const upgraded = new FlashcardDb(name);
    opened.push(upgraded);
    const row = await upgraded.scheduling.get({ cardId: 'card-1', direction: 'recognition' });

    expect(row?.fsrs.reps).toBe(7);
  });
});

describe('v3 → v4 upgrade', () => {
  it('backfills updatedAt so old rows push on first sign-in, and drops handles', async () => {
    const name = `flashcard-migration-${counter++}`;

    const legacy = openV3(name);
    await legacy.table('decks').put({
      id: 'deck-1',
      name: 'Chinese',
      language: 'zh-Hans',
      productionEnabled: true,
      createdAt: 1,
    });
    await legacy.table('scheduling').put(schedulingRow('card-1', 'recognition'));
    await legacy.table('handles').put({ id: 'backup-dir', handle: {}, linkedAt: 1 });
    legacy.close();

    const upgraded = new FlashcardDb(name);
    opened.push(upgraded);

    expect((await upgraded.decks.get('deck-1'))?.updatedAt).toBeGreaterThan(0);
    const row = await upgraded.scheduling.get({ cardId: 'card-1', direction: 'recognition' });
    expect(row?.updatedAt).toBeGreaterThan(0);
    expect(upgraded.tables.map((table) => table.name)).not.toContain('handles');
  });

  it('a fresh database opens straight at v4 with sync stores usable', async () => {
    const db = freshDb();

    await db.syncState.put({ id: 'sync', userId: 'user-1', pulledAt: {}, pushedAt: 0 });

    expect(await db.tombstones.count()).toBe(0);
    expect((await db.syncState.get('sync'))?.userId).toBe('user-1');
  });
});

describe('change tracking', () => {
  it('fires for every synced table, settings included', async () => {
    const db = freshDb();
    let changes = 0;
    const unsubscribe = db.onChanged(() => changes++);

    await db.cards.put({
      id: 'card-1',
      deckId: 'deck-1',
      term: '发生',
      sentence: '发生了什么？',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    expect(changes).toBe(1);

    await db.cards.update('card-1', { meaning: 'to happen' });
    await db.cards.delete('card-1');
    expect(changes).toBe(3);

    await db.settings.put({ id: 'app-settings', newCardsPerDay: 15, targetRetention: 0.9, lastExportAt: 0 });
    expect(changes).toBe(4);

    unsubscribe();
    await db.decks.put({ id: 'deck-1', name: 'Chinese', language: 'zh-Hans', productionEnabled: true, createdAt: 1 });
    expect(changes).toBe(4);
  });

  it('stamps updatedAt on every local create and update', async () => {
    const db = freshDb();
    const before = Date.now();

    await db.decks.put({ id: 'deck-1', name: 'Chinese', language: 'zh-Hans', productionEnabled: true, createdAt: 1 });
    expect((await db.decks.get('deck-1'))?.updatedAt).toBeGreaterThanOrEqual(before);

    await db.scheduling.put({ ...schedulingRow('card-1', 'recognition'), updatedAt: 1 });
    await db.scheduling.update(['card-1', 'recognition'] as never, { due: 99 });
    const row = await db.scheduling.get({ cardId: 'card-1', direction: 'recognition' });
    expect(row?.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it('leaves a tombstone for each deleted row, cascades included', async () => {
    const db = freshDb();
    await db.cards.put({
      id: 'card-1',
      deckId: 'deck-1',
      term: '发生',
      sentence: '发生了什么？',
      tags: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await db.scheduling.bulkPut([
      schedulingRow('card-1', 'recognition'),
      schedulingRow('card-1', 'production'),
    ]);

    await deleteCardCascade(db, 'card-1');
    await delay(10);

    const keys = (await db.tombstones.toArray()).map((t) => `${t.table}:${t.key}`).sort();
    expect(keys).toEqual([
      'cards:card-1',
      'scheduling:["card-1","production"]',
      'scheduling:["card-1","recognition"]',
    ]);
  });

  it('leaves remote writes unstamped, unannounced, and without tombstones', async () => {
    const db = freshDb();
    let changes = 0;
    db.onChanged(() => changes++);

    await db.applyRemote(['decks'], async () => {
      await db.decks.put({
        id: 'deck-1',
        name: 'Chinese',
        language: 'zh-Hans',
        productionEnabled: true,
        createdAt: 1,
        updatedAt: 5,
      });
    });
    expect((await db.decks.get('deck-1'))?.updatedAt).toBe(5);

    await db.applyRemote(['decks'], async () => {
      await db.decks.delete('deck-1');
    });
    await delay(10);

    expect(changes).toBe(0);
    expect(await db.tombstones.count()).toBe(0);
  });
});
