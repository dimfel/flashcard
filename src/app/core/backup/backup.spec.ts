import { describe, expect, it } from 'vitest';
import { createEmptyCard, State } from 'ts-fsrs';
import { makeCard, makeDeck } from '../../../testing/fixtures';
import { schedulingFrom, type Scheduling } from '../models/card.types';
import {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  BackupParseError,
  backupFilename,
  mergeById,
  mergeScheduling,
  parseBackup,
  serialiseBackup,
  type BackupFile,
} from './backup';

const deck = makeDeck({ createdAt: 1_700_000_000_000 });
const card = makeCard();

function backupWith(overrides: Partial<BackupFile> = {}): BackupFile {
  const scheduling = schedulingFrom(
    'card-1',
    'recognition',
    createEmptyCard(new Date('2026-08-09T12:00:00.000Z')),
  );

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: 1_700_000_600_000,
    decks: [deck],
    cards: [card],
    scheduling: [scheduling],
    reviewLogs: [],
    settings: null,
    ...overrides,
  };
}

describe('backup round-trip', () => {
  it('preserves every authored field', () => {
    const restored = parseBackup(serialiseBackup(backupWith()));

    expect(restored.decks).toEqual([deck]);
    expect(restored.cards).toEqual([card]);
  });

  it('revives fsrs Date fields, which JSON would otherwise leave as strings', () => {
    const restored = parseBackup(serialiseBackup(backupWith()));

    expect(restored.scheduling[0].fsrs.due).toBeInstanceOf(Date);
    expect(restored.scheduling[0].due).toBe(new Date('2026-08-09T12:00:00.000Z').getTime());
  });

  it('revives last_review when the card has been reviewed', () => {
    const reviewed = schedulingFrom('card-1', 'production', {
      ...createEmptyCard(new Date('2026-08-09T12:00:00.000Z')),
      last_review: new Date('2026-08-08T09:30:00.000Z'),
      reps: 3,
      state: State.Review,
    });

    const restored = parseBackup(serialiseBackup(backupWith({ scheduling: [reviewed] })));

    expect(restored.scheduling[0].fsrs.last_review).toBeInstanceOf(Date);
    expect(restored.scheduling[0].fsrs.last_review?.toISOString()).toBe('2026-08-08T09:30:00.000Z');
  });

  it('keeps the denormalised due in step with the revived blob', () => {
    const restored = parseBackup(serialiseBackup(backupWith()));
    const row = restored.scheduling[0];

    expect(row.due).toBe(row.fsrs.due.getTime());
  });
});

describe('parseBackup validation', () => {
  it('rejects malformed JSON', () => {
    expect(() => parseBackup('{ not json')).toThrow(BackupParseError);
  });

  it('rejects a file that is not a flashcard backup', () => {
    expect(() => parseBackup(JSON.stringify({ hello: 'world' }))).toThrow(BackupParseError);
  });

  it('rejects a backup from a newer app version', () => {
    const future = JSON.stringify({ ...backupWith(), version: BACKUP_VERSION + 1 });
    expect(() => parseBackup(future)).toThrow(/newer than this app understands/);
  });

  it('defaults tags on a hand-edited card that dropped them', () => {
    const stripped = JSON.stringify({
      ...backupWith(),
      cards: [{ ...card, tags: undefined }],
    });

    expect(parseBackup(stripped).cards[0].tags).toEqual([]);
  });

  it('imports a v1 backup, dropping the usage note field 3 used to hold', () => {
    const v1 = JSON.stringify({
      ...backupWith(),
      version: 1,
      cards: [
        {
          ...card,
          usage: {
            note: '书面语气偏重，多含贬义。',
            register: 'formal',
            collocations: ['顽固不化'],
            contrasts: [{ with: '固执', note: '固执可中性。' }],
          },
        },
      ],
    });

    const restored = parseBackup(v1);

    expect(restored.cards[0]).not.toHaveProperty('usage');
    expect(restored.cards[0].term).toBe('顽固');
    expect(restored.cards[0].reading).toBe('wán gù');
  });
});

describe('mergeById', () => {
  it('keeps the newer copy of a card edited on another device', () => {
    const older = { ...card, meaning: 'old', updatedAt: 1 };
    const newer = { ...card, meaning: 'new', updatedAt: 2 };

    const merged = mergeById([older], [newer], (a, b) => a.updatedAt >= b.updatedAt);

    expect(merged).toEqual([newer]);
  });

  it('keeps the local copy when the imported one is older', () => {
    const local = { ...card, meaning: 'local', updatedAt: 9 };
    const imported = { ...card, meaning: 'imported', updatedAt: 2 };

    const merged = mergeById([local], [imported], (a, b) => a.updatedAt >= b.updatedAt);

    expect(merged).toEqual([local]);
  });

  it('unions cards that exist on only one side', () => {
    const other = { ...card, id: 'card-2' };

    const merged = mergeById([card], [other], (a, b) => a.updatedAt >= b.updatedAt);

    expect(merged.map((c) => c.id).sort()).toEqual(['card-1', 'card-2']);
  });
});

describe('mergeScheduling', () => {
  const rowWith = (direction: 'recognition' | 'production', reps: number): Scheduling =>
    schedulingFrom('card-1', direction, {
      ...createEmptyCard(new Date('2026-08-09T12:00:00.000Z')),
      reps,
    });

  it('keeps the row with more review history', () => {
    const merged = mergeScheduling([rowWith('recognition', 1)], [rowWith('recognition', 7)]);

    expect(merged).toHaveLength(1);
    expect(merged[0].fsrs.reps).toBe(7);
  });

  it('does not let a fresher import overwrite a longer local history', () => {
    const merged = mergeScheduling([rowWith('recognition', 9)], [rowWith('recognition', 0)]);

    expect(merged[0].fsrs.reps).toBe(9);
  });

  it('treats the two directions of one card as separate rows', () => {
    const merged = mergeScheduling([rowWith('recognition', 3)], [rowWith('production', 4)]);

    expect(merged).toHaveLength(2);
  });
});

describe('backupFilename', () => {
  it('stamps the date so backups sort and do not overwrite each other', () => {
    expect(backupFilename(new Date('2026-08-09T23:00:00.000Z'))).toBe('flashcards-2026-08-09.json');
  });
});
