import { describe, expect, it } from 'vitest';
import { makeCard, makeDeck } from '../../../testing/fixtures';
import type { SyncTable } from '../db/flashcard-db';
import type { ReviewLog, Scheduling, Settings } from '../models/card.types';
import {
  fromRemote,
  localKey,
  toRemote,
  tombstoneToRemote,
  type RemoteRecord,
  type SyncRow,
} from './mappers';

const USER = 'user-1';
const SERVER_TIME = '2026-09-14T10:42:39.123456+00:00';

/** What the row looks like after a trip through Postgres and JSON. */
function roundTrip(table: SyncTable, row: SyncRow) {
  const record = JSON.parse(JSON.stringify(toRemote(table, row, USER))) as RemoteRecord;
  return fromRemote(table, { ...record, server_updated_at: SERVER_TIME });
}

const scheduling: Scheduling = {
  cardId: 'card-1',
  direction: 'production',
  due: Date.parse('2026-09-20T00:00:00Z'),
  state: 2,
  fsrs: {
    due: new Date('2026-09-20T00:00:00Z'),
    stability: 12.5,
    difficulty: 5.1,
    elapsed_days: 3,
    scheduled_days: 6,
    learning_steps: 0,
    reps: 7,
    lapses: 1,
    state: 2,
    last_review: new Date('2026-09-14T00:00:00Z'),
  },
  updatedAt: 1_700_000_900_000,
};

describe('sync mappers', () => {
  it('round-trips a deck', () => {
    const deck = { ...makeDeck(), updatedAt: 5 };
    expect(roundTrip('decks', deck).row).toEqual(deck);
  });

  it('round-trips a card, including blank optional fields', () => {
    const full = makeCard();
    const sparse = makeCard({ reading: undefined, meaning: undefined, sentenceTranslation: undefined });

    expect(roundTrip('cards', full).row).toEqual(full);
    expect(roundTrip('cards', sparse).row).toEqual(sparse);
  });

  it('round-trips scheduling with its FSRS dates revived as Dates', () => {
    const incoming = roundTrip('scheduling', scheduling);
    const row = incoming.row as Scheduling;

    expect(row).toEqual(scheduling);
    expect(row.fsrs.due).toBeInstanceOf(Date);
    expect(row.fsrs.last_review).toBeInstanceOf(Date);
    expect(incoming.primaryKey).toEqual(['card-1', 'production']);
    expect(incoming.key).toBe(localKey('scheduling', scheduling));
  });

  it('round-trips a review log and the scheduling row it can undo to', () => {
    const log: ReviewLog = {
      id: 'log-1',
      cardId: 'card-1',
      direction: 'production',
      rating: 3,
      reviewedAt: 1_700_000_000_000,
      elapsedMs: 4200,
      previous: scheduling,
      updatedAt: 9,
    };

    const row = roundTrip('reviewLogs', log).row as ReviewLog;

    expect(row).toEqual(log);
    expect(row.previous.fsrs.due).toBeInstanceOf(Date);
  });

  it('round-trips settings but never carries lastExportAt, which is per device', () => {
    const settings: Settings = {
      id: 'app-settings',
      newCardsPerDay: 20,
      targetRetention: 0.92,
      lastExportAt: 123,
      updatedAt: 4,
    };

    expect(roundTrip('settings', settings).row).toEqual({ ...settings, lastExportAt: 0 });
  });

  it('reads a deleted remote row as a deletion with no row', () => {
    const incoming = fromRemote('cards', {
      id: 'card-1',
      deleted: true,
      updated_at: 7,
      server_updated_at: SERVER_TIME,
    });

    expect(incoming.row).toBeNull();
    expect(incoming.key).toBe('card-1');
    expect(incoming.updatedAt).toBe(7);
    expect(incoming.serverUpdatedAt).toBe(Date.parse(SERVER_TIME));
  });

  it('turns a scheduling tombstone back into its composite key columns', () => {
    const record = tombstoneToRemote(
      { table: 'scheduling', key: JSON.stringify(['card-1', 'recognition']), deletedAt: 11 },
      USER,
    );

    expect(record).toEqual({
      user_id: USER,
      card_id: 'card-1',
      direction: 'recognition',
      updated_at: 11,
      deleted: true,
    });
  });
});
