/**
 * IndexedDB access via Dexie.
 *
 * Deliberately NOT using Dexie's `liveQuery`/observables: this app has one
 * reactivity model (signals), and stores reload explicitly after writes. Mixing
 * in RxJS here would buy convenience at the cost of two ways to do everything.
 */

import Dexie, { type EntityTable, type Table, type Transaction } from 'dexie';
import {
  DEFAULT_SETTINGS,
  SETTINGS_ID,
  type Card,
  type Deck,
  type ReviewLog,
  type Scheduling,
  type Settings,
} from '../models/card.types';

/** Tables mirrored to the cloud. Order matters: parents are pushed before children. */
export type SyncTable = 'decks' | 'cards' | 'scheduling' | 'reviewLogs' | 'settings';
export const SYNC_TABLES: readonly SyncTable[] = [
  'decks',
  'cards',
  'scheduling',
  'reviewLogs',
  'settings',
];

/** A local delete not yet pushed. `key` is the primary key, JSON-encoded if compound. */
export interface Tombstone {
  table: SyncTable;
  key: string;
  deletedAt: number;
}

export const SYNC_STATE_ID = 'sync';

/** Sync cursors, reset whenever a different account signs in. */
export interface SyncState {
  id: string;
  userId: string;
  /** Per table, the newest server timestamp (epoch ms) pulled so far. */
  pulledAt: Partial<Record<SyncTable, number>>;
  /** Local `updatedAt` at or above which rows still need pushing. */
  pushedAt: number;
}

/**
 * Marks carried on the underlying IDBTransaction, which — unlike Dexie's
 * `Transaction` wrapper — is shared by nested transactions.
 */
interface TaggedIdbTransaction extends IDBTransaction {
  deckcardRemote?: boolean;
  deckcardTombstones?: Tombstone[];
}

export class FlashcardDb extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  scheduling!: EntityTable<Scheduling, 'cardId'>;
  reviewLogs!: EntityTable<ReviewLog, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  tombstones!: Table<Tombstone, [SyncTable, string]>;
  syncState!: EntityTable<SyncState, 'id'>;

  private readonly changeListeners = new Set<() => void>();

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

    // v2 drops the structured `usage` note (field 3 became pinyin). The schema
    // is unchanged — `usage` was never indexed — so this version exists purely
    // to carry the data migration.
    this.version(2)
      .stores({
        decks: 'id, name',
        cards: 'id, deckId, term, updatedAt, *tags',
        scheduling: '[cardId+direction], due, cardId, [cardId+due]',
        reviewLogs: 'id, cardId, reviewedAt',
        settings: 'id',
      })
      .upgrade(async (tx) => {
        await tx
          .table('cards')
          .toCollection()
          .modify((card: Record<string, unknown>) => {
            delete card['usage'];
          });
      });

    // v3 added `handles` for the folder auto-backup, since replaced by sync.
    this.version(3).stores({
      decks: 'id, name',
      cards: 'id, deckId, term, updatedAt, *tags',
      scheduling: '[cardId+direction], due, cardId, [cardId+due]',
      reviewLogs: 'id, cardId, reviewedAt',
      settings: 'id',
      handles: 'id',
    });

    // v4 is cloud sync: every synced table gets an indexed `updatedAt` (the push
    // cursor), deletes leave tombstones, and the auto-backup handle store goes.
    // Rows that predate it are backfilled so the first sign-in pushes them.
    this.version(4)
      .stores({
        decks: 'id, name, updatedAt',
        cards: 'id, deckId, term, updatedAt, *tags',
        scheduling: '[cardId+direction], due, cardId, [cardId+due], updatedAt',
        reviewLogs: 'id, cardId, reviewedAt, updatedAt',
        settings: 'id, updatedAt',
        tombstones: '[table+key], deletedAt',
        syncState: 'id',
        handles: null,
      })
      .upgrade(async (tx) => {
        const now = Date.now();
        for (const name of SYNC_TABLES) {
          await tx
            .table(name)
            .toCollection()
            .modify((row: { updatedAt?: number }) => {
              row.updatedAt ??= now;
            });
        }
      });

    this.trackChanges();
  }

  /**
   * Stamps `updatedAt`, records tombstones, and notifies listeners for every
   * local write to a synced table.
   *
   * Hooking Dexie rather than the stores means every write is caught, including
   * writes from code not yet written — the alternative fails as a future
   * mutation that silently never syncs.
   *
   * Writes made through `applyRemote` are skipped entirely: they already carry
   * the server's `updatedAt`, and re-stamping or re-announcing them would bounce
   * every pulled row straight back to the server.
   */
  private trackChanges(): void {
    const notify = () => {
      for (const listener of this.changeListeners) {
        listener();
      }
    };

    for (const name of SYNC_TABLES) {
      const table = this.table(name);

      table.hook('creating', (_primKey, obj: { updatedAt?: number }, tx) => {
        if (isRemote(tx)) {
          return;
        }
        obj.updatedAt = Date.now();
        notify();
      });

      table.hook('updating', (_modifications, _primKey, _obj, tx) => {
        if (isRemote(tx)) {
          return undefined;
        }
        notify();
        return { updatedAt: Date.now() };
      });

      table.hook('deleting', (primKey, _obj, tx) => {
        if (isRemote(tx)) {
          return;
        }
        this.recordTombstone(tx, name, primKey);
        notify();
      });
    }
  }

  /**
   * A hook may only write to tables in its transaction's scope, and deletes
   * come from many scopes. So tombstones are collected on the transaction and
   * written once it commits. A crash in that gap makes the deleted row reappear
   * after the next pull — an annoyance, never a loss.
   */
  private recordTombstone(tx: Transaction, table: SyncTable, primKey: unknown): void {
    const idb = tx.idbtrans as TaggedIdbTransaction;
    const tombstone: Tombstone = {
      table,
      key: typeof primKey === 'string' ? primKey : JSON.stringify(primKey),
      deletedAt: Date.now(),
    };

    if (idb.deckcardTombstones) {
      idb.deckcardTombstones.push(tombstone);
      return;
    }

    const pending = [tombstone];
    idb.deckcardTombstones = pending;
    idb.addEventListener('complete', () => {
      void this.tombstones.bulkPut(pending);
    });
  }

  /** Runs `work` in a transaction whose writes are not stamped, announced, or tombstoned. */
  async applyRemote(tableNames: string[], work: () => Promise<void>): Promise<void> {
    await this.transaction('rw', tableNames, async (tx) => {
      (tx.idbtrans as TaggedIdbTransaction).deckcardRemote = true;
      await work();
    });
  }

  /**
   * Subscribes to local data changes. Returns an unsubscribe function.
   *
   * Fires once per row, so a bulk import calls it hundreds of times — listeners
   * must be cheap enough to survive that, i.e. set a flag rather than do work.
   */
  onChanged(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  /** Reads settings, seeding defaults on first run. */
  async getSettings(): Promise<Settings> {
    const existing = await this.settings.get(SETTINGS_ID);
    if (existing) {
      return existing;
    }
    // Copied: the creating hook stamps `updatedAt` onto the object it is given.
    await this.settings.put({ ...DEFAULT_SETTINGS });
    return { ...DEFAULT_SETTINGS };
  }

  /** Wipes all card data and settings. `clear()` fires no hooks, so nothing syncs as deleted. */
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

function isRemote(tx: Transaction | undefined): boolean {
  return (tx?.idbtrans as TaggedIdbTransaction | undefined)?.deckcardRemote === true;
}

let instance: FlashcardDb | undefined;

/**
 * The app-wide instance, created on first request rather than at module load.
 *
 * Laziness is load-bearing in tests: Dexie captures `globalThis.indexedDB` in
 * its constructor, and the specs install `fake-indexeddb` via a side-effect
 * import. A module-level `new FlashcardDb()` would run whenever the bundler
 * happened to evaluate this module — which for a spec that never touches the
 * database can be before that shim is in place, poisoning every later spec with
 * `MissingAPIError`. Tests construct their own `FlashcardDb` and never call this.
 */
export function getDb(): FlashcardDb {
  return (instance ??= new FlashcardDb());
}
