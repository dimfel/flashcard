import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackupParseError } from '../../core/backup/backup';
import { BackupService, type ImportResult } from '../../core/backup/backup.service';
import { SettingsStore } from '../../core/state/settings.store';
import { DeckStore } from '../../core/state/deck.store';
import { AutoBackupService } from '../../core/backup/auto-backup.service';
import { assetUrl } from '../../core/assets/asset-url';
import { LATEST_FILENAME as LATEST_BACKUP_NAME } from '../../core/backup/auto-backup';

/** What `public/corpus/cmn-eng.meta.json` holds, for the credits line. */
interface CorpusMeta {
  retrievedAt: string;
  lines: number;
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
  protected readonly autoBackup = inject(AutoBackupService);

  readonly settings = this.settingsStore.settings;
  readonly importResult = signal<ImportResult | null>(null);
  readonly importError = signal('');
  readonly busy = signal(false);
  readonly corpusMeta = signal<CorpusMeta | null>(null);

  async ngOnInit(): Promise<void> {
    await this.settingsStore.load();
    await this.loadCorpusMeta();
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

  lastAutoSavedLabel(): string {
    const at = this.autoBackup.lastSavedAt();
    return at ? new Date(at).toLocaleTimeString() : 'not yet this session';
  }

  async chooseBackupFolder(): Promise<void> {
    this.busy.set(true);
    try {
      await this.autoBackup.chooseFolder();
    } finally {
      this.busy.set(false);
    }
  }

  async reconnectBackupFolder(): Promise<void> {
    this.busy.set(true);
    try {
      await this.autoBackup.reconnect();
    } finally {
      this.busy.set(false);
    }
  }

  async stopAutoBackup(): Promise<void> {
    await this.autoBackup.unlink();
  }

  /** Reads the linked folder's backup back in, through the same merge as import. */
  async restoreFromBackupFolder(): Promise<void> {
    this.busy.set(true);
    this.importError.set('');
    this.importResult.set(null);

    try {
      this.importResult.set(await this.autoBackup.restoreFromLink());
      await this.deckStore.load();
    } catch {
      this.importError.set(
        `No ${LATEST_BACKUP_NAME} was found in that folder, or it could not be read.`,
      );
    } finally {
      this.busy.set(false);
    }
  }
}
