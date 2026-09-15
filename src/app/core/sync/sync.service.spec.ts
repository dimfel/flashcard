import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, freshDb, provideTestDb } from '../../../testing/db-harness';
import { makeDeck, makeDraft } from '../../../testing/fixtures';
import { SYNC_STATE_ID, type FlashcardDb, type SyncTable } from '../db/flashcard-db';
import { CardStore } from '../state/card.store';
import { CONFLICT_COLUMNS, type RemoteRecord } from './mappers';
import { SYNC_BACKEND, type SyncBackend, type SyncUser } from './sync-backend';
import { SYNC_TIMING, SyncService } from './sync.service';

/** Real timers, scaled down — fake timers deadlock against fake-indexeddb. */
const DEBOUNCE_MS = 30;
const MAX_WAIT_MS = 90;
const EMAIL = 'me@example.com';

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** An in-memory Supabase: upserts by conflict key and stamps a server time. */
class FakeBackend implements SyncBackend {
  configured = true;
  user: SyncUser | null = null;
  failNextPush: Error | null = null;
  readonly pushed: { table: SyncTable; records: RemoteRecord[] }[] = [];

  private readonly tables = new Map<SyncTable, Map<string, RemoteRecord>>();
  private clock = Date.now();

  async currentUser(): Promise<SyncUser | null> {
    return this.user;
  }

  async signIn(email: string): Promise<SyncUser> {
    this.user = { id: 'user-1', email };
    return this.user;
  }

  async signUp(email: string): Promise<SyncUser> {
    return this.signIn(email);
  }

  async signOut(): Promise<void> {
    this.user = null;
  }

  async pull(table: SyncTable, sinceMs: number): Promise<RemoteRecord[]> {
    return [...this.rows(table).values()]
      .filter((record) => Date.parse(String(record['server_updated_at'])) >= sinceMs)
      .map(clone);
  }

  async push(table: SyncTable, records: RemoteRecord[]): Promise<void> {
    if (this.failNextPush) {
      const error = this.failNextPush;
      this.failNextPush = null;
      throw error;
    }
    this.pushed.push({ table, records: clone(records) });
    for (const record of records) {
      this.seed(table, record);
    }
  }

  /** A write from another device. */
  seed(table: SyncTable, record: RemoteRecord): void {
    const key = CONFLICT_COLUMNS[table]
      .split(',')
      .map((column) => String(record[column]))
      .join('|');
    const existing = this.rows(table).get(key);
    this.rows(table).set(key, {
      ...existing,
      ...clone(record),
      server_updated_at: new Date(++this.clock).toISOString(),
    });
  }

  get(table: SyncTable, id: string): RemoteRecord | undefined {
    return [...this.rows(table).values()].find((record) => record['id'] === id);
  }

  all(table: SyncTable): RemoteRecord[] {
    return [...this.rows(table).values()];
  }

  pushedIds(table: SyncTable): unknown[] {
    return this.pushed.filter((p) => p.table === table).flatMap((p) => p.records.map((r) => r['id']));
  }

  private rows(table: SyncTable): Map<string, RemoteRecord> {
    let rows = this.tables.get(table);
    if (!rows) {
      rows = new Map();
      this.tables.set(table, rows);
    }
    return rows;
  }
}

describe('SyncService', () => {
  let db: FlashcardDb;
  let backend: FakeBackend;
  let service: SyncService;
  let cards: CardStore;

  function setUp(configure?: (backend: FakeBackend) => void): void {
    backend = new FakeBackend();
    configure?.(backend);
    db = freshDb();
    TestBed.configureTestingModule({
      providers: [
        provideTestDb(db),
        { provide: SYNC_BACKEND, useValue: backend },
        { provide: SYNC_TIMING, useValue: { debounceMs: DEBOUNCE_MS, maxWaitMs: MAX_WAIT_MS } },
      ],
    });
    service = TestBed.inject(SyncService);
    cards = TestBed.inject(CardStore);
  }

  async function addCard(term = '顽固') {
    const deck = makeDeck();
    if (!(await db.decks.get(deck.id))) {
      await db.decks.put(deck);
    }
    return cards.create(deck, makeDraft({ term }));
  }

  afterEach(async () => {
    await closeDb(db);
  });

  describe('signed in', () => {
    beforeEach(() => setUp());

    it('pushes every existing local row on the first sign-in', async () => {
      const card = await addCard();

      await service.signIn(EMAIL, 'correct-horse');

      expect(service.status()).toBe('idle');
      expect(backend.get('decks', 'deck-1')).toMatchObject({ user_id: 'user-1', deleted: false });
      expect(backend.get('cards', card.id)).toMatchObject({ term: '顽固' });
      expect(backend.all('scheduling')).toHaveLength(2);
      expect(service.lastSyncedAt()).toBeGreaterThan(0);
    });

    it('pulls a change made on another device without pushing it back', async () => {
      await service.signIn(EMAIL, 'correct-horse');
      backend.seed('decks', {
        user_id: 'user-1',
        id: 'deck-remote',
        name: 'From my phone',
        language: 'zh-Hans',
        production_enabled: false,
        created_at: 1,
        updated_at: Date.now(),
        deleted: false,
      });

      await service.sync();
      await service.sync();

      expect((await db.decks.get('deck-remote'))?.name).toBe('From my phone');
      expect(backend.pushedIds('decks')).not.toContain('deck-remote');
      expect(service.remoteChanges()).toBeGreaterThan(0);
    });

    it('takes the remote copy when it was edited more recently', async () => {
      await addCard();
      await service.signIn(EMAIL, 'correct-horse');
      await delay(5);

      backend.seed('decks', { ...backend.get('decks', 'deck-1'), name: 'Renamed', updated_at: Date.now() });
      await service.sync();

      expect((await db.decks.get('deck-1'))?.name).toBe('Renamed');
    });

    it('keeps a local edit made after the remote one, and pushes it', async () => {
      await addCard();
      await service.signIn(EMAIL, 'correct-horse');
      backend.seed('decks', { ...backend.get('decks', 'deck-1'), name: 'Remote', updated_at: Date.now() });
      await delay(5);

      await db.decks.update('deck-1', { name: 'Local' });
      await service.sync();

      expect((await db.decks.get('deck-1'))?.name).toBe('Local');
      expect(backend.get('decks', 'deck-1')?.['name']).toBe('Local');
    });

    it('pushes a local delete, cascade included, as deleted rows', async () => {
      const card = await addCard();
      await service.signIn(EMAIL, 'correct-horse');

      await cards.remove(card.id);
      await delay(10);
      await service.sync();

      expect(backend.get('cards', card.id)?.['deleted']).toBe(true);
      expect(backend.all('scheduling').every((row) => row['deleted'] === true)).toBe(true);
      expect(await db.tombstones.count()).toBe(0);
    });

    it('does not let a stale remote copy resurrect a card deleted here', async () => {
      const card = await addCard();
      await service.signIn(EMAIL, 'correct-horse');

      await cards.remove(card.id);
      await delay(10);
      await service.sync();
      await service.sync();

      expect(await db.cards.get(card.id)).toBeUndefined();
    });

    it('applies a delete made on another device', async () => {
      const card = await addCard();
      await service.signIn(EMAIL, 'correct-horse');
      await delay(5);

      backend.seed('cards', { ...backend.get('cards', card.id), deleted: true, updated_at: Date.now() });
      await service.sync();

      expect(await db.cards.get(card.id)).toBeUndefined();
      expect(await db.tombstones.count()).toBe(0);
    });

    it('keeps its cursor and retries after a failed push', async () => {
      await addCard();
      backend.failNextPush = new Error('Network down');

      await service.signIn(EMAIL, 'correct-horse');

      expect(service.status()).toBe('error');
      expect(service.error()).toBe('Network down');
      expect(await db.syncState.get(SYNC_STATE_ID)).toBeUndefined();

      await service.sync();

      expect(service.status()).toBe('idle');
      expect(backend.get('decks', 'deck-1')).toBeTruthy();
    });

    it('syncs on its own shortly after a local edit', async () => {
      await service.signIn(EMAIL, 'correct-horse');

      const card = await addCard('发生');
      await delay(DEBOUNCE_MS * 4);
      await service.sync();

      expect(backend.get('cards', card.id)).toMatchObject({ term: '发生' });
    });

    it('keeps local cards when signing out', async () => {
      await addCard();
      await service.signIn(EMAIL, 'correct-horse');

      await service.signOut();

      expect(service.status()).toBe('signed-out');
      expect(service.signedIn()).toBe(false);
      expect(await db.cards.count()).toBe(1);
      expect(await db.syncState.get(SYNC_STATE_ID)).toBeUndefined();
    });
  });

  it('restores the session at start and syncs without being asked', async () => {
    setUp((fake) => {
      fake.user = { id: 'user-1', email: EMAIL };
    });
    await addCard();

    await service.init();
    await service.sync();

    expect(service.email()).toBe(EMAIL);
    expect(backend.get('decks', 'deck-1')).toBeTruthy();
  });

  it('does nothing until someone signs in', async () => {
    setUp();
    await service.init();

    await addCard();
    await delay(MAX_WAIT_MS * 2);

    expect(service.status()).toBe('signed-out');
    expect(backend.pushed).toEqual([]);
  });

  it('reports unconfigured when the build has no Supabase project', async () => {
    setUp((fake) => {
      fake.configured = false;
    });

    await service.init();

    expect(service.status()).toBe('unconfigured');
  });
});
