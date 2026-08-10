import { computed, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { FLASHCARD_DB } from '../db/db.token';
import { BACKUP_DIR_HANDLE_ID } from '../db/flashcard-db';
import { SettingsStore } from '../state/settings.store';
import { BackupService, type ImportResult } from './backup.service';
import { serialiseBackup } from './backup';
import {
  LATEST_FILENAME,
  snapshotFilename,
  snapshotsToPrune,
} from './auto-backup';

export interface AutoBackupTiming {
  /** Quiet period after the last change before writing. */
  debounceMs: number;
  /**
   * Ceiling on how long changes can keep pushing the write back. A long review
   * session is a continuous stream of edits, and without this the file would not
   * be written until the session ended.
   */
  maxWaitMs: number;
}

/**
 * Injected rather than hardcoded so specs can run the real timers at a scale a
 * test can wait for — fake timers deadlock against `fake-indexeddb`, which
 * drains its transaction queue on real ones.
 */
export const AUTO_BACKUP_TIMING = new InjectionToken<AutoBackupTiming>('AUTO_BACKUP_TIMING', {
  providedIn: 'root',
  factory: () => ({ debounceMs: 10_000, maxWaitMs: 60_000 }),
});

export type AutoBackupStatus =
  /** No File System Access API — Firefox, Safari, any phone. */
  | 'unsupported'
  /** Supported, but no folder chosen yet. */
  | 'unlinked'
  /** Folder chosen and writable. */
  | 'linked'
  /** Handle survived, permission did not. Needs a click to resume. */
  | 'needs-permission'
  /** Mid-write. */
  | 'saving'
  /** Last write failed; the message is in `error`. */
  | 'error';

/**
 * Keeps a JSON backup current in a folder the user picked.
 *
 * Everything the app knows lives in one IndexedDB, so "clear browsing data" is
 * an unrecoverable event. This turns durability from something the user has to
 * remember into something that happens on its own — on desktop Chromium, which
 * is the only place the File System Access API exists.
 *
 * The folder handle is itself stored in IndexedDB, which means a wipe takes the
 * handle too. Restore therefore usually starts with the user re-picking the
 * folder; see `restoreFromPickedFolder`.
 */
@Injectable({ providedIn: 'root' })
export class AutoBackupService {
  private readonly db = inject(FLASHCARD_DB);
  private readonly backups = inject(BackupService);
  private readonly settingsStore = inject(SettingsStore);
  private readonly timing = inject(AUTO_BACKUP_TIMING);

  private readonly state = signal<AutoBackupStatus>(
    supportsDirectoryPicker() ? 'unlinked' : 'unsupported',
  );
  readonly status = this.state.asReadonly();

  readonly folderName = signal<string | null>(null);
  readonly lastSavedAt = signal<number | null>(null);
  readonly error = signal('');

  /** True when there is a folder to read a backup back out of. */
  readonly canRestoreFromLink = computed(
    () => this.folderName() !== null && this.state() !== 'unsupported',
  );

  readonly supported = supportsDirectoryPicker();

  private directory: FileSystemDirectoryHandle | null = null;
  private dirty = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Serialises writes so an exit flush cannot interleave with a debounced one. */
  private writing: Promise<void> = Promise.resolve();
  private started = false;

  /**
   * Restores the saved folder handle and starts listening. Called once at app
   * start via `provideAppInitializer`; safe to call again.
   */
  async init(): Promise<void> {
    if (this.started || !this.supported) {
      return;
    }
    this.started = true;

    this.db.onChanged(() => this.markDirty());
    this.listenForExit();

    const stored = await this.db.handles.get(BACKUP_DIR_HANDLE_ID);
    if (!stored) {
      return;
    }

    this.directory = stored.handle;
    this.folderName.set(stored.handle.name);

    // Only ever *query* here. `requestPermission` without a user gesture fails,
    // and burning the one chance to re-grant on a page load nobody asked for
    // would leave the user with a button that appears broken.
    const permission = await queryPermission(stored.handle);
    this.state.set(permission === 'granted' ? 'linked' : 'needs-permission');
  }

  /** Opens the picker and links a folder. Must be called from a user gesture. */
  async chooseFolder(): Promise<void> {
    if (!this.supported) {
      return;
    }

    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({
        id: 'deckcard-backup',
        mode: 'readwrite',
        startIn: 'documents',
      });
    } catch {
      // The user dismissed the picker. Not an error worth reporting.
      return;
    }

    await this.link(handle);
    // Write immediately, so linking visibly produces a file rather than a
    // promise that something will happen within ten seconds.
    await this.flush({ force: true });
  }

  /** Re-requests permission on a handle that survived but went stale. */
  async reconnect(): Promise<void> {
    if (!this.directory) {
      return;
    }

    const permission = await requestPermission(this.directory);
    if (permission === 'granted') {
      this.state.set('linked');
      this.error.set('');
      await this.flush({ force: true });
      return;
    }

    this.error.set('Permission to write to that folder was declined.');
    this.state.set('needs-permission');
  }

  /** Forgets the folder. The files already written are left alone. */
  async unlink(): Promise<void> {
    this.cancelTimers();
    this.directory = null;
    this.folderName.set(null);
    this.lastSavedAt.set(null);
    this.error.set('');
    this.state.set(this.supported ? 'unlinked' : 'unsupported');
    await this.db.handles.delete(BACKUP_DIR_HANDLE_ID);
  }

  /** Imports `flashcards-latest.json` from the already-linked folder. */
  async restoreFromLink(): Promise<ImportResult> {
    if (!this.directory) {
      throw new Error('No backup folder is linked.');
    }
    return this.restoreFrom(this.directory);
  }

  /**
   * Opens the picker and restores from whatever folder the user points at,
   * linking it on the way through.
   *
   * This is the path that matters after a wipe: the handle died with the data,
   * so the app has no idea where its backups are until it is told again.
   */
  async restoreFromPickedFolder(): Promise<ImportResult | null> {
    if (!this.supported) {
      return null;
    }

    let handle: FileSystemDirectoryHandle;
    try {
      handle = await window.showDirectoryPicker({
        id: 'deckcard-backup',
        mode: 'readwrite',
        startIn: 'documents',
      });
    } catch {
      return null;
    }

    const result = await this.restoreFrom(handle);
    await this.link(handle);
    return result;
  }

  /**
   * Writes now, if there is anything to write. Awaits any in-flight write first
   * so two triggers cannot produce interleaved output.
   *
   * `force` writes even when nothing has changed — used when linking or
   * reconnecting, where the point is to produce a file and prove the folder
   * works rather than to mirror an edit.
   */
  async flush(options?: { force?: boolean }): Promise<void> {
    if (this.state() === 'needs-permission' || !this.directory) {
      return;
    }

    this.cancelTimers();
    const force = options?.force ?? false;
    this.writing = this.writing.then(() => this.write(force));
    return this.writing;
  }

  private async restoreFrom(directory: FileSystemDirectoryHandle): Promise<ImportResult> {
    const fileHandle = await directory.getFileHandle(LATEST_FILENAME);
    const text = await (await fileHandle.getFile()).text();
    const result = await this.backups.importFrom(text);
    // The import just rewrote the database, which marked everything dirty.
    // Nothing has actually diverged from the file, so don't bounce it back.
    this.dirty = false;
    this.cancelTimers();
    return result;
  }

  private async link(handle: FileSystemDirectoryHandle): Promise<void> {
    this.directory = handle;
    this.folderName.set(handle.name);
    this.state.set('linked');
    this.error.set('');
    await this.db.handles.put({
      id: BACKUP_DIR_HANDLE_ID,
      handle,
      linkedAt: Date.now(),
    });
  }

  private markDirty(): void {
    this.dirty = true;
    if (!this.directory || this.state() === 'needs-permission') {
      return;
    }

    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => void this.flush(), this.timing.debounceMs);

    // Started once and left running: a steady stream of edits keeps resetting
    // the debounce, and this is what guarantees a write anyway.
    this.maxWaitTimer ??= setTimeout(() => void this.flush(), this.timing.maxWaitMs);
  }

  private listenForExit(): void {
    // `visibilitychange` to hidden and `pagehide` are the only signals a browser
    // reliably delivers before it may discard the page; `beforeunload` cannot
    // host async work at all. The write is still best-effort — which is exactly
    // why the debounce exists, so there is rarely much left to lose.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        void this.flush();
      }
    });
    globalThis.addEventListener('pagehide', () => void this.flush());
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

  private async write(force: boolean): Promise<void> {
    const directory = this.directory;
    if (!directory || (!this.dirty && !force)) {
      return;
    }

    this.dirty = false;
    this.state.set('saving');

    try {
      const backup = await this.backups.collect();
      const json = serialiseBackup(backup);

      await writeFile(directory, LATEST_FILENAME, json);

      // One dated snapshot a day, so a bad save cannot quietly become the only
      // copy. Existence is the "already done today" check — no extra state.
      const snapshot = snapshotFilename();
      if (!(await hasFile(directory, snapshot))) {
        await writeFile(directory, snapshot, json);
        await this.prune(directory);
      }

      this.lastSavedAt.set(backup.exportedAt);
      this.state.set('linked');
      this.error.set('');
      await this.settingsStore.update({ lastExportAt: backup.exportedAt });
    } catch (error) {
      // Leave it dirty so the next trigger retries rather than assuming the
      // file on disk is current.
      this.dirty = true;
      this.error.set(describe(error));
      this.state.set(isPermissionError(error) ? 'needs-permission' : 'error');
    }
  }

  private async prune(directory: FileSystemDirectoryHandle): Promise<void> {
    const names: string[] = [];
    for await (const entry of directory.values()) {
      if (entry.kind === 'file') {
        names.push(entry.name);
      }
    }

    for (const name of snapshotsToPrune(names)) {
      await directory.removeEntry(name);
    }
  }
}

function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

/**
 * Permission methods are optional on a `FileSystemHandle` — origin-private
 * handles, for one, are always writable and implement neither. Treating a
 * missing method as "granted" keeps the service working with any handle rather
 * than throwing on the ones that need no permission at all.
 */
async function queryPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  if (typeof handle.queryPermission !== 'function') {
    return 'granted';
  }
  return handle.queryPermission({ mode: 'readwrite' });
}

async function requestPermission(handle: FileSystemDirectoryHandle): Promise<PermissionState> {
  if (typeof handle.requestPermission !== 'function') {
    return 'granted';
  }
  return handle.requestPermission({ mode: 'readwrite' });
}

/**
 * `createWritable` stages to a temp file and swaps on close, so a crash
 * mid-write cannot leave a half-written backup where a whole one used to be.
 */
async function writeFile(
  directory: FileSystemDirectoryHandle,
  name: string,
  contents: string,
): Promise<void> {
  const fileHandle = await directory.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(contents);
  await writable.close();
}

async function hasFile(directory: FileSystemDirectoryHandle, name: string): Promise<boolean> {
  try {
    await directory.getFileHandle(name);
    return true;
  } catch {
    return false;
  }
}

function isPermissionError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'NotAllowedError';
}

function describe(error: unknown): string {
  if (isPermissionError(error)) {
    return 'Lost permission to write to the backup folder.';
  }
  return error instanceof Error ? error.message : 'The backup could not be written.';
}
