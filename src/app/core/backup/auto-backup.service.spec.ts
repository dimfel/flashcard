import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDb, freshDb, provideTestDb } from '../../../testing/db-harness';
import { makeDeck, makeDraft } from '../../../testing/fixtures';
import type { FlashcardDb, StoredHandle } from '../db/flashcard-db';
import { BACKUP_DIR_HANDLE_ID } from '../db/flashcard-db';
import { CardStore } from '../state/card.store';
import { SettingsStore } from '../state/settings.store';
import { LATEST_FILENAME } from './auto-backup';
import { AUTO_BACKUP_TIMING, AutoBackupService } from './auto-backup.service';

/**
 * Real timers, scaled down.
 *
 * Fake timers deadlock here: `fake-indexeddb` drains its transaction queue on
 * real `setTimeout`, so freezing the clock hangs every database call. Injecting
 * short durations keeps the timing behaviour genuinely exercised.
 */
const DEBOUNCE_MS = 30;
const MAX_WAIT_MS = 90;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * An in-memory stand-in for a real folder.
 *
 * jsdom has no File System Access API at all, so the whole surface the service
 * touches is faked here: enough to prove what gets written, what gets deleted,
 * and that permission states are respected.
 */
class FakeDirectory {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  readonly removed: string[] = [];
  permission: PermissionState = 'granted';
  requestedPermission = 0;
  /** Set to make the next write throw, simulating a revoked folder. */
  failNextWrite: Error | null = null;

  readonly kind = 'directory' as const;
  readonly name = 'Backups';

  async queryPermission(): Promise<PermissionState> {
    return this.permission;
  }

  async requestPermission(): Promise<PermissionState> {
    this.requestedPermission++;
    return this.permission;
  }

  async getFileHandle(name: string, options?: { create?: boolean }) {
    if (!this.files.has(name) && !options?.create) {
      throw new DOMException(`${name} not found`, 'NotFoundError');
    }

    return {
      kind: 'file' as const,
      name,
      getFile: async () => ({ text: async () => this.files.get(name) ?? '' }),
      createWritable: async () => {
        if (this.failNextWrite) {
          const error = this.failNextWrite;
          this.failNextWrite = null;
          throw error;
        }
        let buffer = '';
        return {
          write: async (chunk: string) => {
            buffer += chunk;
          },
          close: async () => {
            this.files.set(name, buffer);
            this.writes.push(name);
          },
        };
      },
    };
  }

  async removeEntry(name: string): Promise<void> {
    this.files.delete(name);
    this.removed.push(name);
  }

  async *values() {
    for (const name of this.files.keys()) {
      yield { kind: 'file' as const, name };
    }
  }

  asHandle(): FileSystemDirectoryHandle {
    return this as unknown as FileSystemDirectoryHandle;
  }
}

describe('AutoBackupService', () => {
  let db: FlashcardDb;
  let service: AutoBackupService;
  let cards: CardStore;
  let directory: FakeDirectory;
  let storedHandle: StoredHandle | undefined;

  /**
   * Stands in for the `handles` table.
   *
   * A real `FileSystemDirectoryHandle` is specially serializable; a fake class
   * instance is not — structured clone drops the prototype, so a handle that
   * went through IndexedDB would come back without its methods. That the table
   * itself stores and returns a handle is covered in `migration.spec.ts`.
   */
  function stubHandleStore(): void {
    // Cast through `never`: Dexie returns its own PromiseExtended, which a
    // plain async function does not satisfy structurally.
    vi.spyOn(db.handles, 'put').mockImplementation((async (row: StoredHandle) => {
      storedHandle = row;
      return row.id;
    }) as never);
    vi.spyOn(db.handles, 'get').mockImplementation((async () => storedHandle) as never);
    vi.spyOn(db.handles, 'delete').mockImplementation((async () => {
      storedHandle = undefined;
    }) as never);
  }

  /** Links the folder without going through the picker. */
  async function link(): Promise<void> {
    storedHandle = { id: BACKUP_DIR_HANDLE_ID, handle: directory.asHandle(), linkedAt: 1 };
    await service.init();
  }

  async function addCard(term: string): Promise<void> {
    await cards.create(makeDeck(), makeDraft({ term }));
  }

  beforeEach(() => {
    directory = new FakeDirectory();
    storedHandle = undefined;
    // The service feature-detects at construction, so this must exist first.
    vi.stubGlobal('showDirectoryPicker', vi.fn(async () => directory.asHandle()));

    db = freshDb();
    TestBed.configureTestingModule({
      providers: [
        provideTestDb(db),
        {
          provide: AUTO_BACKUP_TIMING,
          useValue: { debounceMs: DEBOUNCE_MS, maxWaitMs: MAX_WAIT_MS },
        },
      ],
    });
    stubHandleStore();
    service = TestBed.inject(AutoBackupService);
    cards = TestBed.inject(CardStore);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    await closeDb(db);
  });

  describe('linking', () => {
    it('starts unlinked when the API is available but no folder was chosen', async () => {
      await service.init();

      expect(service.status()).toBe('unlinked');
      expect(service.folderName()).toBeNull();
    });

    it('restores the folder from a previous session without prompting', async () => {
      await link();

      expect(service.status()).toBe('linked');
      expect(service.folderName()).toBe('Backups');
      expect(directory.requestedPermission).toBe(0);
    });

    it('asks for a reconnect rather than failing when permission went stale', async () => {
      directory.permission = 'prompt';

      await link();

      expect(service.status()).toBe('needs-permission');
      // Requesting on a page load would burn the gesture-less attempt.
      expect(directory.requestedPermission).toBe(0);
    });

    it('writes nothing while permission is missing', async () => {
      directory.permission = 'prompt';
      await link();

      await addCard('顽固');
      await delay(MAX_WAIT_MS * 2);

      expect(directory.writes).toEqual([]);
    });

    it('resumes and writes once reconnected', async () => {
      directory.permission = 'prompt';
      await link();
      await addCard('顽固');

      directory.permission = 'granted';
      await service.reconnect();

      expect(service.status()).toBe('linked');
      expect(directory.files.has(LATEST_FILENAME)).toBe(true);
    });

    it('writes immediately on linking, so choosing a folder visibly does something', async () => {
      await addCard('顽固');
      await service.chooseFolder();

      expect(directory.files.has(LATEST_FILENAME)).toBe(true);
      expect(await db.handles.get(BACKUP_DIR_HANDLE_ID)).toBeTruthy();
    });

    it('treats a dismissed picker as a no-op, not an error', async () => {
      vi.stubGlobal(
        'showDirectoryPicker',
        vi.fn(async () => {
          throw new DOMException('The user aborted a request.', 'AbortError');
        }),
      );

      await service.chooseFolder();

      expect(service.status()).toBe('unlinked');
      expect(service.error()).toBe('');
    });

    it('forgets the folder on unlink but leaves the written files alone', async () => {
      await link();
      await addCard('顽固');
      await service.flush();

      await service.unlink();

      expect(service.status()).toBe('unlinked');
      expect(service.folderName()).toBeNull();
      expect(await db.handles.get(BACKUP_DIR_HANDLE_ID)).toBeUndefined();
      expect(directory.files.has(LATEST_FILENAME)).toBe(true);
    });
  });

  describe('triggers', () => {
    it('waits out the quiet period before writing', async () => {
      await link();
      await addCard('顽固');

      expect(directory.writes).toEqual([]);

      await delay(DEBOUNCE_MS * 2);
      expect(directory.writes).toContain(LATEST_FILENAME);
    });

    it('coalesces a burst of edits into a single write', async () => {
      await link();

      for (const term of ['一', '二', '三']) {
        await addCard(term);
      }
      await delay(DEBOUNCE_MS * 2);

      expect(directory.writes.filter((name) => name === LATEST_FILENAME)).toHaveLength(1);
    });

    it('writes anyway when edits never stop coming', async () => {
      await link();

      // Each edit resets the debounce, so only the ceiling can save this.
      const until = Date.now() + MAX_WAIT_MS * 2;
      let i = 0;
      while (Date.now() < until) {
        await addCard(`词${String(i++)}`);
        await delay(DEBOUNCE_MS / 3);
      }

      expect(directory.writes.length).toBeGreaterThan(0);
    });

    it('flushes when the tab is hidden instead of waiting', async () => {
      await link();
      await addCard('顽固');

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
      document.dispatchEvent(new Event('visibilitychange'));
      await delay(5);

      expect(directory.writes).toContain(LATEST_FILENAME);
    });

    it('ignores a tab becoming visible', async () => {
      await link();
      await addCard('顽固');

      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      document.dispatchEvent(new Event('visibilitychange'));
      await delay(5);

      expect(directory.writes).toEqual([]);
    });

    it('does not rewrite the file when nothing changed', async () => {
      await link();
      await addCard('顽固');
      await service.flush();
      const after = directory.writes.length;

      await service.flush();

      expect(directory.writes).toHaveLength(after);
    });

    it('does not fire for a settings change, which would loop forever', async () => {
      await link();
      await service.flush();
      const after = directory.writes.length;

      await TestBed.inject(SettingsStore).update({ newCardsPerDay: 7 });
      await delay(MAX_WAIT_MS * 2);

      expect(directory.writes).toHaveLength(after);
    });
  });

  describe('what it writes', () => {
    it('writes both the latest file and a dated snapshot on the first save of a day', async () => {
      await link();
      await addCard('顽固');

      await service.flush();

      expect(directory.writes).toHaveLength(2);
      expect(directory.files.has(LATEST_FILENAME)).toBe(true);
      expect([...directory.files.keys()].some((n) => /^flashcards-\d{4}/.test(n))).toBe(true);
    });

    it('writes only the latest file on later saves the same day', async () => {
      await link();
      await addCard('顽固');
      await service.flush();

      await addCard('发生');
      await service.flush();

      expect(directory.writes.filter((n) => n === LATEST_FILENAME)).toHaveLength(2);
      expect(directory.writes.filter((n) => n !== LATEST_FILENAME)).toHaveLength(1);
    });

    it('writes a parseable backup containing the cards', async () => {
      await link();
      await addCard('顽固');

      await service.flush();

      const written = JSON.parse(directory.files.get(LATEST_FILENAME) ?? '{}') as {
        format: string;
        cards: { term: string }[];
      };
      expect(written.format).toBe('flashcard-backup');
      expect(written.cards.map((c) => c.term)).toEqual(['顽固']);
    });

    it('prunes old snapshots without touching the latest file', async () => {
      await link();
      for (let day = 1; day <= 20; day++) {
        directory.files.set(`flashcards-2026-01-${String(day).padStart(2, '0')}.json`, '{}');
      }
      await addCard('顽固');

      await service.flush();

      // 20 pre-existing snapshots plus today's makes 21; the limit is 14.
      expect(directory.removed).toHaveLength(7);
      expect(directory.removed).toContain('flashcards-2026-01-01.json');
      expect(directory.removed).toContain('flashcards-2026-01-07.json');
      expect(directory.removed).not.toContain('flashcards-2026-01-08.json');
      expect(directory.removed).not.toContain(LATEST_FILENAME);
      expect(directory.files.has(LATEST_FILENAME)).toBe(true);
    });

    it('stamps lastExportAt, so the stale-backup nudge stops nagging', async () => {
      const settings = TestBed.inject(SettingsStore);
      await settings.load();
      await link();
      await addCard('顽固');

      await service.flush();

      expect(settings.settings().lastExportAt).toBeGreaterThan(0);
      expect(service.lastSavedAt()).toBeGreaterThan(0);
    });
  });

  describe('failure', () => {
    it('surfaces a write failure and retries on the next change', async () => {
      await link();
      await addCard('顽固');
      directory.failNextWrite = new Error('Disk full');

      await service.flush();
      expect(service.status()).toBe('error');
      expect(service.error()).toBe('Disk full');

      await service.flush();
      expect(service.status()).toBe('linked');
      expect(directory.files.has(LATEST_FILENAME)).toBe(true);
    });

    it('drops to needs-permission when the folder is revoked mid-session', async () => {
      await link();
      await addCard('顽固');
      directory.failNextWrite = new DOMException('Denied', 'NotAllowedError');

      await service.flush();

      expect(service.status()).toBe('needs-permission');
      expect(service.error()).toMatch(/permission/i);
    });
  });

  describe('restore', () => {
    it('imports the latest file from the linked folder', async () => {
      await link();
      await addCard('顽固');
      await service.flush();
      await db.cards.clear();

      const result = await service.restoreFromLink();

      expect(result.cards).toBe(1);
      expect(await db.cards.count()).toBe(1);
    });

    it('links the folder it was pointed at, which is the post-wipe path', async () => {
      // A backup exists on disk, but this profile knows nothing about it.
      directory.files.set(
        LATEST_FILENAME,
        JSON.stringify({
          format: 'flashcard-backup',
          version: 2,
          exportedAt: 1,
          decks: [makeDeck()],
          cards: [],
          scheduling: [],
          reviewLogs: [],
          settings: null,
        }),
      );
      await service.init();
      expect(service.status()).toBe('unlinked');

      const result = await service.restoreFromPickedFolder();

      expect(result?.decks).toBe(1);
      expect(service.status()).toBe('linked');
      expect(await db.handles.get(BACKUP_DIR_HANDLE_ID)).toBeTruthy();
    });

    it('does not bounce the restored data straight back to disk', async () => {
      await link();
      await addCard('顽固');
      await service.flush();
      const after = directory.writes.length;

      await service.restoreFromLink();
      await delay(MAX_WAIT_MS * 2);

      expect(directory.writes).toHaveLength(after);
    });

    it('refuses to restore with no folder linked', async () => {
      await service.init();

      await expect(service.restoreFromLink()).rejects.toThrow(/no backup folder/i);
    });
  });

  it('accepts a handle that implements no permission methods at all', async () => {
    // Origin-private handles are always writable and implement neither method.
    // Built as a plain object rather than by deleting from FakeDirectory, whose
    // methods live on the prototype and so survive `delete`.
    const bare = {
      kind: 'directory' as const,
      name: directory.name,
      getFileHandle: directory.getFileHandle.bind(directory),
      removeEntry: directory.removeEntry.bind(directory),
      values: directory.values.bind(directory),
    };
    expect('queryPermission' in bare).toBe(false);

    storedHandle = {
      id: BACKUP_DIR_HANDLE_ID,
      handle: bare as unknown as FileSystemDirectoryHandle,
      linkedAt: 1,
    };

    await service.init();
    expect(service.status()).toBe('linked');

    await addCard('顽固');
    await service.flush();
    expect(directory.files.has(LATEST_FILENAME)).toBe(true);
  });

  describe('unsupported browsers', () => {
    beforeEach(async () => {
      await closeDb(db);
      TestBed.resetTestingModule();
      vi.unstubAllGlobals();

      db = freshDb();
      TestBed.configureTestingModule({
        providers: [
          provideTestDb(db),
          {
            provide: AUTO_BACKUP_TIMING,
            useValue: { debounceMs: DEBOUNCE_MS, maxWaitMs: MAX_WAIT_MS },
          },
        ],
      });
      stubHandleStore();
      service = TestBed.inject(AutoBackupService);
      cards = TestBed.inject(CardStore);
    });

    it('reports unsupported instead of offering a broken button', async () => {
      await service.init();

      expect(service.supported).toBe(false);
      expect(service.status()).toBe('unsupported');
    });

    it('never throws when asked to do anything', async () => {
      await service.init();
      await addCard('顽固');
      await delay(MAX_WAIT_MS * 2);

      await expect(service.chooseFolder()).resolves.toBeUndefined();
      await expect(service.restoreFromPickedFolder()).resolves.toBeNull();
      await expect(service.flush()).resolves.toBeUndefined();
    });
  });
});
