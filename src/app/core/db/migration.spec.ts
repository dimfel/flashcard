/**
 * Schema migration tests.
 *
 * These open a bare Dexie at the OLD version, write old-shaped rows, close, and
 * reopen through `FlashcardDb` so the upgrade path actually runs. Asserting on
 * the upgrade function directly would prove nothing: the bug worth catching is
 * a version block that never fires on a real database.
 */

import Dexie from 'dexie';
import { afterEach, describe, expect, it } from 'vitest';
import { FlashcardDb } from './flashcard-db';

let counter = 0;
let opened: (Dexie | FlashcardDb)[] = [];

const LEGACY_STORES = {
  decks: 'id, name',
  cards: 'id, deckId, term, updatedAt, *tags',
  scheduling: '[cardId+direction], due, cardId, [cardId+due]',
  reviewLogs: 'id, cardId, reviewedAt',
  settings: 'id',
};

/** A v1 database, exactly as it was before field 3 became pinyin. */
function openV1(name: string): Dexie {
  const legacy = new Dexie(name);
  legacy.version(1).stores(LEGACY_STORES);
  opened.push(legacy);
  return legacy;
}

/** A v2 database — post-pinyin, but before the auto-backup handles store. */
function openV2(name: string): Dexie {
  const legacy = new Dexie(name);
  legacy.version(1).stores(LEGACY_STORES);
  legacy.version(2).stores(LEGACY_STORES);
  opened.push(legacy);
  return legacy;
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

describe('v2 → v3 upgrade', () => {
  it('adds the handles store without disturbing existing cards', async () => {
    const name = `flashcard-migration-${counter++}`;

    const legacy = openV2(name);
    await legacy.table('cards').put({
      id: 'card-1',
      deckId: 'deck-1',
      term: '顽固',
      sentence: '他顽固地拒绝了所有建议。',
      reading: 'wán gù',
      tags: ['hsk6'],
      createdAt: 1,
      updatedAt: 2,
    });
    legacy.close();

    const upgraded = new FlashcardDb(name);
    opened.push(upgraded);

    expect(await upgraded.cards.get('card-1')).toMatchObject({ term: '顽固', reading: 'wán gù' });
    expect(await upgraded.handles.count()).toBe(0);
  });

  it('a fresh database opens straight at v3 with the handles store usable', async () => {
    const db = new FlashcardDb(`flashcard-migration-${counter++}`);
    opened.push(db);

    await db.handles.put({
      id: 'backup-dir',
      // A handle is opaque here; the store only has to hold and return it.
      handle: { kind: 'directory', name: 'Backups' } as unknown as FileSystemDirectoryHandle,
      linkedAt: 5,
    });

    expect((await db.handles.get('backup-dir'))?.handle.name).toBe('Backups');
  });
});

describe('change tracking', () => {
  it('fires for card data and stays quiet for settings, which would loop', async () => {
    const db = new FlashcardDb(`flashcard-migration-${counter++}`);
    opened.push(db);

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

    // Auto-backup stamps lastExportAt after every save; if that re-triggered a
    // save the app would write in a loop until the tab was closed.
    const before = changes;
    await db.settings.put({
      id: 'app-settings',
      newCardsPerDay: 15,
      targetRetention: 0.9,
      lastExportAt: 12,
    });
    await db.handles.put({
      id: 'backup-dir',
      handle: { kind: 'directory', name: 'Backups' } as unknown as FileSystemDirectoryHandle,
      linkedAt: 1,
    });
    expect(changes).toBe(before);

    unsubscribe();
    await db.decks.put({
      id: 'deck-1',
      name: 'Chinese',
      language: 'zh-Hans',
      productionEnabled: true,
      createdAt: 1,
    });
    expect(changes).toBe(before);
  });
});
