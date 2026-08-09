/**
 * Backup serialisation.
 *
 * Everything this app knows lives in IndexedDB, which the browser may clear
 * without warning. A JSON export is therefore not a nice-to-have — it is the
 * only durable copy, and it doubles as the sync story (drop the file in cloud
 * storage, import it on the other device).
 *
 * These functions are pure so the round-trip can be tested without a database.
 */

import type { Card, Deck, ReviewLog, Scheduling, Settings } from '../models/card.types';

export const BACKUP_FORMAT = 'flashcard-backup';
export const BACKUP_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAt: number;
  decks: Deck[];
  cards: Card[];
  scheduling: Scheduling[];
  reviewLogs: ReviewLog[];
  settings: Settings | null;
}

export class BackupParseError extends Error {}

export function serialiseBackup(backup: BackupFile): string {
  return JSON.stringify(backup, null, 2);
}

/**
 * Parses and validates a backup, reviving the `Date` fields inside the ts-fsrs
 * blobs. JSON flattens those to ISO strings, and ts-fsrs does date arithmetic on
 * them — skipping this step produces silently corrupt scheduling rather than a
 * loud failure, so it is done eagerly at the boundary.
 */
export function parseBackup(json: string): BackupFile {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new BackupParseError('That file is not valid JSON.');
  }

  if (!isRecord(raw) || raw['format'] !== BACKUP_FORMAT) {
    throw new BackupParseError('That file is not a flashcard backup.');
  }
  if (typeof raw['version'] !== 'number' || raw['version'] > BACKUP_VERSION) {
    throw new BackupParseError(
      `Backup version ${String(raw['version'])} is newer than this app understands.`,
    );
  }

  const scheduling = asArray<Scheduling>(raw['scheduling']).map(reviveScheduling);

  return {
    format: BACKUP_FORMAT,
    version: raw['version'],
    exportedAt: typeof raw['exportedAt'] === 'number' ? raw['exportedAt'] : Date.now(),
    decks: asArray<Deck>(raw['decks']),
    cards: asArray<Card>(raw['cards']).map(reviveCard),
    scheduling,
    reviewLogs: asArray<ReviewLog>(raw['reviewLogs']).map((log) => ({
      ...log,
      previous: reviveScheduling(log.previous),
    })),
    settings: isRecord(raw['settings']) ? (raw['settings'] as unknown as Settings) : null,
  };
}

function reviveScheduling(row: Scheduling): Scheduling {
  const fsrs = { ...row.fsrs, due: new Date(row.fsrs.due) };
  if (row.fsrs.last_review) {
    fsrs.last_review = new Date(row.fsrs.last_review);
  }
  return { ...row, fsrs, due: fsrs.due.getTime() };
}

/** Guards against a hand-edited file missing the collection fields on field 3. */
function reviveCard(card: Card): Card {
  return {
    ...card,
    tags: card.tags ?? [],
    usage: {
      note: card.usage?.note ?? '',
      register: card.usage?.register,
      collocations: card.usage?.collocations ?? [],
      contrasts: card.usage?.contrasts ?? [],
    },
  };
}

/**
 * Merges an imported backup over local data, newest-wins by `updatedAt`.
 *
 * Merge rather than replace: the common case is two devices that have each
 * gained cards since the last sync, and replacing would silently discard one
 * side's work.
 */
export function mergeById<T extends { id: string }>(
  local: readonly T[],
  incoming: readonly T[],
  isNewer: (incoming: T, local: T) => boolean,
): T[] {
  const merged = new Map(local.map((item) => [item.id, item]));

  for (const item of incoming) {
    const existing = merged.get(item.id);
    if (!existing || isNewer(item, existing)) {
      merged.set(item.id, item);
    }
  }

  return [...merged.values()];
}

/**
 * Scheduling has no `updatedAt`, so review count stands in for recency: the copy
 * that has been reviewed more times is the one with the longer history.
 */
export function mergeScheduling(
  local: readonly Scheduling[],
  incoming: readonly Scheduling[],
): Scheduling[] {
  const key = (row: Scheduling) => `${row.cardId}::${row.direction}`;
  const merged = new Map(local.map((row) => [key(row), row]));

  for (const row of incoming) {
    const existing = merged.get(key(row));
    if (!existing || row.fsrs.reps >= existing.fsrs.reps) {
      merged.set(key(row), row);
    }
  }

  return [...merged.values()];
}

/** `flashcards-2026-08-09.json` */
export function backupFilename(now: Date = new Date()): string {
  return `flashcards-${now.toISOString().slice(0, 10)}.json`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}
