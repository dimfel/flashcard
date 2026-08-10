/**
 * IndexedDB access via Dexie.
 *
 * Deliberately NOT using Dexie's `liveQuery`/observables: this app has one
 * reactivity model (signals), and stores reload explicitly after writes. Mixing
 * in RxJS here would buy convenience at the cost of two ways to do everything.
 */

import Dexie, { type EntityTable, type Table } from 'dexie';
import {
  DEFAULT_SETTINGS,
  SETTINGS_ID,
  type Card,
  type Deck,
  type ReviewLog,
  type Scheduling,
  type Settings,
} from '../models/card.types';

/** Key of the single row holding the auto-backup folder handle. */
export const BACKUP_DIR_HANDLE_ID = 'backup-dir';

/**
 * A directory handle the user has granted access to, parked in IndexedDB.
 *
 * Handles survive structured cloning, which is the only way to keep folder
 * access across visits. Note the consequence: clearing site data takes the
 * handle along with the cards, so this cannot rescue the app from a wipe on its
 * own — see `AutoBackupService`.
 */
export interface StoredHandle {
  id: string;
  handle: FileSystemDirectoryHandle;
  linkedAt: number;
}

export class FlashcardDb extends Dexie {
  decks!: EntityTable<Deck, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  scheduling!: EntityTable<Scheduling, 'cardId'>;
  reviewLogs!: EntityTable<ReviewLog, 'id'>;
  settings!: EntityTable<Settings, 'id'>;
  handles!: EntityTable<StoredHandle, 'id'>;

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
    // to carry the data migration. The store map is repeated rather than left
    // empty so this block reads as the current truth; identical schemas are a
    // no-op to Dexie.
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

    // v3 adds `handles` for the auto-backup folder. Purely additive — Dexie
    // creates the new store and leaves every existing row alone, so no upgrade
    // function is needed.
    this.version(3).stores({
      decks: 'id, name',
      cards: 'id, deckId, term, updatedAt, *tags',
      scheduling: '[cardId+direction], due, cardId, [cardId+due]',
      reviewLogs: 'id, cardId, reviewedAt',
      settings: 'id',
      handles: 'id',
    });

    this.trackChanges();
  }

  /**
   * Notifies listeners whenever card data changes, so auto-backup knows the file
   * on disk has gone stale.
   *
   * Hooking Dexie rather than the stores means every write is caught, including
   * writes from code not yet written — the failure mode of the alternative is a
   * future mutation that silently stops being backed up.
   *
   * `settings` is deliberately excluded: auto-backup stamps `lastExportAt` when
   * it finishes, and hooking that table would re-arm the debounce forever.
   * Settings are still captured in every backup; they just don't trigger one.
   * `handles` is excluded for the same reason.
   */
  private trackChanges(): void {
    const notify = () => {
      for (const listener of this.changeListeners) {
        listener();
      }
    };

    const tracked: Table<unknown, unknown>[] = [
      this.decks as unknown as Table<unknown, unknown>,
      this.cards as unknown as Table<unknown, unknown>,
      this.scheduling as unknown as Table<unknown, unknown>,
      this.reviewLogs as unknown as Table<unknown, unknown>,
    ];

    for (const table of tracked) {
      table.hook('creating', notify);
      table.hook('updating', notify);
      table.hook('deleting', notify);
    }
  }

  /**
   * Subscribes to data changes. Returns an unsubscribe function.
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
    await this.settings.put(DEFAULT_SETTINGS);
    return { ...DEFAULT_SETTINGS };
  }

  /**
   * Wipes all card data and settings.
   *
   * `handles` is left alone on purpose: the auto-backup folder is a property of
   * this browser profile, not of the data, and re-picking it needs a user
   * gesture that a bulk clear cannot supply.
   */
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
