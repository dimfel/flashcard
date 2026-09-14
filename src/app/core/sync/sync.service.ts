import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { FLASHCARD_DB } from '../db/db.token';
import {
  SYNC_STATE_ID,
  SYNC_TABLES,
  type SyncState,
  type Tombstone,
} from '../db/flashcard-db';
import type { Settings } from '../models/card.types';
import { fromRemote, localKey, toRemote, tombstoneToRemote, type SyncRow } from './mappers';
import { SYNC_BACKEND, type SyncUser } from './sync-backend';

export interface SyncTiming {
  /** Quiet period after the last local change before syncing. */
  debounceMs: number;
  /** Ceiling on how long a stream of edits (a review session) can defer a sync. */
  maxWaitMs: number;
}

/** Injected so specs can run real timers at a scale a test can wait for. */
export const SYNC_TIMING = new InjectionToken<SyncTiming>('SYNC_TIMING', {
  providedIn: 'root',
  factory: () => ({ debounceMs: 5_000, maxWaitMs: 30_000 }),
});

/**
 * Pulls re-read this far behind the cursor. `server_updated_at` is a commit-
 * start time, so a slow transaction can land behind rows already pulled.
 * Re-applying a row is harmless.
 */
const PULL_OVERLAP_MS = 5_000;

export type SyncStatus =
  /** No Supabase project configured in this build. */
  | 'unconfigured'
  | 'signed-out'
  | 'idle'
  | 'syncing'
  | 'offline'
  | 'error';

export interface StorageReport {
  /** Whether the browser agreed not to clear this site's data under disk pressure. */
  persisted: boolean;
  usageBytes: number | null;
}

/**
 * Keeps IndexedDB and the cloud copy in step.
 *
 * Local-first: every screen still reads and writes Dexie, and this runs in the
 * background — pull (newest `updatedAt` wins, deletes via tombstones), then push
 * whatever changed locally since the last successful push.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly db = inject(FLASHCARD_DB);
  private readonly backend = inject(SYNC_BACKEND);
  private readonly timing = inject(SYNC_TIMING);

  private readonly state = signal<SyncStatus>(
    this.backend.configured ? 'signed-out' : 'unconfigured',
  );
  readonly status = this.state.asReadonly();
  readonly email = signal<string | null>(null);
  readonly lastSyncedAt = signal<number | null>(null);
  readonly error = signal('');
  /** Bumped whenever a pull changed local rows, so open screens can reload. */
  readonly remoteChanges = signal(0);
  readonly storage = signal<StorageReport | null>(null);
  readonly signedIn = computed(() => this.email() !== null);

  private user: SyncUser | null = null;
  private initializing?: Promise<void>;
  /** Serialises syncs so two triggers cannot interleave pulls and pushes. */
  private running: Promise<void> = Promise.resolve();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  /** Restores a saved session and starts listening. Safe to call repeatedly. */
  init(): Promise<void> {
    return (this.initializing ??= this.initOnce());
  }

  async sendCode(email: string): Promise<void> {
    await this.init();
    await this.backend.sendCode(email.trim());
  }

  /** Signs in, then syncs straight away — on a fresh device this is the restore. */
  async verifyCode(email: string, code: string): Promise<void> {
    await this.init();
    this.setUser(await this.backend.verifyCode(email.trim(), code.trim()));
    await this.sync();
  }

  /** Signs out. Local cards stay; only the link to the account goes. */
  async signOut(): Promise<void> {
    this.cancelTimers();
    await this.running;
    await this.backend.signOut();
    this.user = null;
    this.email.set(null);
    this.lastSyncedAt.set(null);
    this.error.set('');
    this.state.set('signed-out');
    await this.db.syncState.delete(SYNC_STATE_ID);
  }

  sync(): Promise<void> {
    if (!this.user) {
      return Promise.resolve();
    }
    this.cancelTimers();
    this.running = this.running.then(() => this.runOnce());
    return this.running;
  }

  private async initOnce(): Promise<void> {
    void this.checkStorage();
    if (!this.backend.configured) {
      return;
    }

    this.db.onChanged(() => this.schedule());
    globalThis.addEventListener?.('online', () => void this.sync());
    globalThis.document?.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.sync();
      }
    });

    try {
      const user = await this.backend.currentUser();
      if (user) {
        this.setUser(user);
        void this.sync();
      }
    } catch (error) {
      // Usually the client chunk failing to load offline; stay signed out.
      this.error.set(describeSyncError(error));
    }
  }

  private setUser(user: SyncUser): void {
    this.user = user;
    this.email.set(user.email);
    this.error.set('');
    this.state.set('idle');
  }

  private schedule(): void {
    if (!this.user) {
      return;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => void this.sync(), this.timing.debounceMs);
    this.maxWaitTimer ??= setTimeout(() => void this.sync(), this.timing.maxWaitMs);
  }

  private cancelTimers(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxWaitTimer !== null) {
      clearTimeout(this.maxWaitTimer);
      this.maxWaitTimer = null;
    }
  }

  private async runOnce(): Promise<void> {
    const user = this.user;
    if (!user) {
      return;
    }
    if (globalThis.navigator?.onLine === false) {
      this.state.set('offline');
      return;
    }

    this.state.set('syncing');
    try {
      const state = await this.loadState(user.id);
      const pulled = await this.pull(state);
      await this.push(state, user.id, pulled);
      // Cursors are saved only after both halves succeed; a failure re-runs both.
      await this.db.syncState.put(state);

      this.lastSyncedAt.set(Date.now());
      this.error.set('');
      this.state.set('idle');
    } catch (error) {
      this.error.set(describeSyncError(error));
      // Cast defeats narrowing from the early return: the connection can drop mid-sync.
      const online = globalThis.navigator?.onLine as boolean | undefined;
      this.state.set(online === false ? 'offline' : 'error');
    }
  }

  private async loadState(userId: string): Promise<SyncState> {
    const saved = await this.db.syncState.get(SYNC_STATE_ID);
    if (saved?.userId === userId) {
      return saved;
    }
    return { id: SYNC_STATE_ID, userId, pulledAt: {}, pushedAt: 0 };
  }

  /**
   * Applies remote rows that are at least as new as the local copy and any
   * pending local delete. Returns `table:key → updatedAt` for everything
   * applied, so the push that follows can skip echoing those rows back.
   */
  private async pull(state: SyncState): Promise<Map<string, number>> {
    const applied = new Map<string, number>();
    let changed = false;

    for (const table of SYNC_TABLES) {
      const cursor = state.pulledAt[table] ?? 0;
      const records = await this.backend.pull(table, Math.max(0, cursor - PULL_OVERLAP_MS));
      if (records.length === 0) {
        continue;
      }

      const incoming = records.map((record) => fromRemote(table, record));
      state.pulledAt[table] = incoming.reduce(
        (newest, item) => Math.max(newest, item.serverUpdatedAt),
        cursor,
      );

      const dexieTable = this.db.table<SyncRow>(table);
      await this.db.applyRemote([table, 'tombstones'], async () => {
        const locals = await dexieTable.bulkGet(incoming.map((item) => item.primaryKey));
        const tombstones = await this.db.tombstones.bulkGet(
          incoming.map((item) => [table, item.key] as [typeof table, string]),
        );

        const puts: SyncRow[] = [];
        const deletes: unknown[] = [];
        const resolvedTombstones: [typeof table, string][] = [];

        incoming.forEach((item, index) => {
          const local = locals[index];
          const tombstone = tombstones[index];

          if (local && (local.updatedAt ?? 0) > item.updatedAt) {
            return;
          }
          if (tombstone) {
            if (tombstone.deletedAt >= item.updatedAt) {
              return;
            }
            resolvedTombstones.push([table, item.key]);
          }

          applied.set(`${table}:${item.key}`, item.updatedAt);
          if (item.row) {
            puts.push(
              table === 'settings' && local
                ? { ...item.row, lastExportAt: (local as Settings).lastExportAt }
                : item.row,
            );
          } else if (local) {
            deletes.push(item.primaryKey);
          }
        });

        if (puts.length > 0) {
          await dexieTable.bulkPut(puts);
        }
        if (deletes.length > 0) {
          await dexieTable.bulkDelete(deletes as never[]);
        }
        if (resolvedTombstones.length > 0) {
          await this.db.tombstones.bulkDelete(resolvedTombstones);
        }
        changed ||= puts.length > 0 || deletes.length > 0;
      });
    }

    if (changed) {
      this.remoteChanges.update((count) => count + 1);
    }
    return applied;
  }

  private async push(state: SyncState, userId: string, pulled: Map<string, number>): Promise<void> {
    // Taken before reading, so a write landing mid-push is picked up next time.
    const startedAt = Date.now();

    for (const table of SYNC_TABLES) {
      const rows = await this.db
        .table<SyncRow>(table)
        .where('updatedAt')
        .aboveOrEqual(state.pushedAt)
        .toArray();
      const records = rows
        .filter((row) => pulled.get(`${table}:${localKey(table, row)}`) !== row.updatedAt)
        .map((row) => toRemote(table, row, userId));
      if (records.length > 0) {
        await this.backend.push(table, records);
      }
    }

    const tombstones: Tombstone[] = await this.db.tombstones.toArray();
    for (const table of SYNC_TABLES) {
      const records = tombstones
        .filter((tombstone) => tombstone.table === table)
        .map((tombstone) => tombstoneToRemote(tombstone, userId));
      if (records.length > 0) {
        await this.backend.push(table, records);
      }
    }
    if (tombstones.length > 0) {
      await this.db.tombstones.bulkDelete(tombstones.map((t) => [t.table, t.key]));
    }

    state.pushedAt = startedAt;
  }

  /**
   * Asks the browser not to evict IndexedDB under disk pressure. Chromium grants
   * it quietly for installed or engaged sites; others may ignore or prompt.
   */
  private async checkStorage(): Promise<void> {
    const storage = globalThis.navigator?.storage;
    if (typeof storage?.persist !== 'function') {
      return;
    }
    try {
      const persisted = (await storage.persisted?.()) || (await storage.persist());
      const estimate = await storage.estimate?.();
      this.storage.set({ persisted, usageBytes: estimate?.usage ?? null });
    } catch {
      this.storage.set(null);
    }
  }
}

export function describeSyncError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === 'string' && message) {
      return message;
    }
  }
  return 'Sync failed.';
}
