import { inject, Injectable } from '@angular/core';
import { FLASHCARD_DB } from '../db/db.token';
import { SettingsStore } from '../state/settings.store';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  backupFilename,
  mergeById,
  mergeScheduling,
  parseBackup,
  serialiseBackup,
  type BackupFile,
} from './backup';

export interface ImportResult {
  decks: number;
  cards: number;
  scheduling: number;
  reviewLogs: number;
}

@Injectable({ providedIn: 'root' })
export class BackupService {
  private readonly db = inject(FLASHCARD_DB);
  private readonly settingsStore = inject(SettingsStore);

  /** Snapshots every table into a backup object. */
  async collect(): Promise<BackupFile> {
    const [decks, cards, scheduling, reviewLogs, settings] = await Promise.all([
      this.db.decks.toArray(),
      this.db.cards.toArray(),
      this.db.scheduling.toArray(),
      this.db.reviewLogs.toArray(),
      this.db.getSettings(),
    ]);

    return {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: Date.now(),
      decks,
      cards,
      scheduling,
      reviewLogs,
      settings,
    };
  }

  /** Triggers a file download and records that a backup was taken. */
  async download(): Promise<void> {
    const backup = await this.collect();
    const blob = new Blob([serialiseBackup(backup)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = backupFilename();
    link.click();
    URL.revokeObjectURL(url);

    await this.settingsStore.update({ lastExportAt: backup.exportedAt });
  }

  /** Parses, merges, and writes a backup file. Throws `BackupParseError` on bad input. */
  async importFrom(json: string): Promise<ImportResult> {
    const backup = parseBackup(json);

    const [localDecks, localCards, localScheduling, localLogs] = await Promise.all([
      this.db.decks.toArray(),
      this.db.cards.toArray(),
      this.db.scheduling.toArray(),
      this.db.reviewLogs.toArray(),
    ]);

    const decks = mergeById(localDecks, backup.decks, () => true);
    const cards = mergeById(
      localCards,
      backup.cards,
      (incoming, local) => incoming.updatedAt >= local.updatedAt,
    );
    const scheduling = mergeScheduling(localScheduling, backup.scheduling);
    const reviewLogs = mergeById(localLogs, backup.reviewLogs, () => false);

    await this.db.transaction(
      'rw',
      this.db.decks,
      this.db.cards,
      this.db.scheduling,
      this.db.reviewLogs,
      async () => {
        await this.db.decks.bulkPut(decks);
        await this.db.cards.bulkPut(cards);
        await this.db.scheduling.bulkPut(scheduling);
        await this.db.reviewLogs.bulkPut(reviewLogs);
      },
    );

    return {
      decks: decks.length,
      cards: cards.length,
      scheduling: scheduling.length,
      reviewLogs: reviewLogs.length,
    };
  }
}
