import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BackupParseError } from '../../core/backup/backup';
import { BackupService, type ImportResult } from '../../core/backup/backup.service';
import { SettingsStore } from '../../core/state/settings.store';
import { DeckStore } from '../../core/state/deck.store';

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

  readonly settings = this.settingsStore.settings;
  readonly importResult = signal<ImportResult | null>(null);
  readonly importError = signal('');
  readonly busy = signal(false);

  async ngOnInit(): Promise<void> {
    await this.settingsStore.load();
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
}
