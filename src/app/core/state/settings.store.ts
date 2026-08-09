import { inject, Injectable, signal } from '@angular/core';
import { FLASHCARD_DB } from '../db/db.token';
import { DEFAULT_SETTINGS, SETTINGS_ID, type Settings } from '../models/card.types';

/** Milliseconds after which the backup nudge appears. */
export const STALE_EXPORT_MS = 30 * 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class SettingsStore {
  private readonly db = inject(FLASHCARD_DB);

  readonly settings = signal<Settings>(DEFAULT_SETTINGS);
  readonly loaded = signal(false);

  async load(): Promise<void> {
    this.settings.set(await this.db.getSettings());
    this.loaded.set(true);
  }

  async update(patch: Partial<Omit<Settings, 'id'>>): Promise<void> {
    const next: Settings = { ...this.settings(), ...patch, id: SETTINGS_ID };
    await this.db.settings.put(next);
    this.settings.set(next);
  }

  /**
   * True when a backup is overdue. Everything lives in IndexedDB, so "clear
   * browsing data" is an unrecoverable event — this drives a visible nudge
   * rather than being left to the user to remember.
   */
  isExportStale(now: number = Date.now()): boolean {
    return now - this.settings().lastExportAt > STALE_EXPORT_MS;
  }
}
