import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackupParseError } from '../../core/backup/backup';
import { BackupService, type ImportResult } from '../../core/backup/backup.service';
import { SettingsStore } from '../../core/state/settings.store';
import { DeckStore } from '../../core/state/deck.store';
import {
  describeSyncError,
  SyncService,
  type StorageReport,
} from '../../core/sync/sync.service';
import { assetUrl } from '../../core/assets/asset-url';

/** What `public/corpus/cmn-eng.meta.json` holds, for the credits line. */
interface CorpusMeta {
  retrievedAt: string;
  lines: number;
}

/** What `public/dictionary/cedict.meta.json` holds, for the credits line. */
interface DictionaryMeta {
  retrievedAt: string;
  terms: number;
}

@Component({
  selector: 'app-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent implements OnInit {
  private readonly settingsStore = inject(SettingsStore);
  private readonly backupService = inject(BackupService);
  private readonly deckStore = inject(DeckStore);
  protected readonly sync = inject(SyncService);

  readonly settings = this.settingsStore.settings;
  readonly importResult = signal<ImportResult | null>(null);
  readonly importError = signal('');
  readonly busy = signal(false);
  readonly corpusMeta = signal<CorpusMeta | null>(null);
  readonly dictionaryMeta = signal<DictionaryMeta | null>(null);

  readonly email = signal('');
  readonly code = signal('');
  readonly codeSent = signal(false);
  readonly syncMessage = signal('');

  async ngOnInit(): Promise<void> {
    void this.sync.init();
    await this.settingsStore.load();
    await Promise.all([this.loadCorpusMeta(), this.loadDictionaryMeta()]);
  }

  /** Resolves against the base href, so it survives the `/flashcard/` deploy. */
  licenseUrl(file: string): string {
    return assetUrl(`licenses/${file}`);
  }

  /**
   * The corpus vintage, shown as part of the Tatoeba attribution. A few hundred
   * bytes, and failing to get it just drops the detail — never the credit.
   */
  private async loadCorpusMeta(): Promise<void> {
    try {
      const response = await fetch(assetUrl('corpus/cmn-eng.meta.json'));
      if (response.ok) {
        this.corpusMeta.set((await response.json()) as CorpusMeta);
      }
    } catch {
      this.corpusMeta.set(null);
    }
  }

  /** Same reasoning as `loadCorpusMeta`: a nice-to-have, never the credit itself. */
  private async loadDictionaryMeta(): Promise<void> {
    try {
      const response = await fetch(assetUrl('dictionary/cedict.meta.json'));
      if (response.ok) {
        this.dictionaryMeta.set((await response.json()) as DictionaryMeta);
      }
    } catch {
      this.dictionaryMeta.set(null);
    }
  }

  async setNewCardsPerDay(value: string): Promise<void> {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) {
      await this.settingsStore.update({ newCardsPerDay: Math.round(parsed) });
    }
  }

  async setTargetRetention(value: string): Promise<void> {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0.7 && parsed <= 0.98) {
      await this.settingsStore.update({ targetRetention: parsed });
    }
  }

  async exportBackup(): Promise<void> {
    this.busy.set(true);
    try {
      await this.backupService.download();
    } finally {
      this.busy.set(false);
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }

    this.busy.set(true);
    this.importError.set('');
    this.importResult.set(null);

    try {
      this.importResult.set(await this.backupService.importFrom(await file.text()));
      await this.deckStore.load();
    } catch (error) {
      this.importError.set(
        error instanceof BackupParseError ? error.message : 'That file could not be imported.',
      );
    } finally {
      this.busy.set(false);
      // Clearing lets the same file be picked twice in a row.
      input.value = '';
    }
  }

  lastExportLabel(): string {
    const at = this.settings().lastExportAt;
    return at ? new Date(at).toLocaleDateString() : 'never';
  }

  async sendCode(): Promise<void> {
    await this.runSyncAction(async () => {
      await this.sync.sendCode(this.email());
      this.codeSent.set(true);
    });
  }

  async verifyCode(): Promise<void> {
    await this.runSyncAction(async () => {
      await this.sync.verifyCode(this.email(), this.code());
      this.codeSent.set(false);
      this.code.set('');
      await this.deckStore.load();
    });
  }

  async syncNow(): Promise<void> {
    await this.runSyncAction(async () => {
      await this.sync.sync();
      await this.deckStore.load();
    });
  }

  async signOut(): Promise<void> {
    await this.runSyncAction(() => this.sync.signOut());
  }

  syncStatusLabel(): string {
    switch (this.sync.status()) {
      case 'syncing':
        return 'syncing…';
      case 'offline':
        return 'offline — will sync when reconnected';
      case 'error':
        return 'last sync failed';
      default: {
        const at = this.sync.lastSyncedAt();
        return at ? `last synced ${new Date(at).toLocaleTimeString()}` : 'not synced yet this session';
      }
    }
  }

  storageLabel(report: StorageReport): string {
    const usage =
      report.usageBytes === null
        ? 'Stored on this device'
        : `Using ${(report.usageBytes / 1_048_576).toFixed(1)} MB on this device`;
    return report.persisted
      ? `${usage} · protected from automatic clearing.`
      : `${usage} · the browser may clear this if disk space runs low.`;
  }

  private async runSyncAction(action: () => Promise<void>): Promise<void> {
    this.busy.set(true);
    this.syncMessage.set('');
    try {
      await action();
    } catch (error) {
      this.syncMessage.set(describeSyncError(error));
    } finally {
      this.busy.set(false);
    }
  }
}
