/**
 * Local (camelCase, Dexie) ↔ remote (snake_case, Postgres) row conversion.
 *
 * Pure, so the round trip is testable without a database or a network. The
 * remote shape mirrors `supabase/migrations/0001_init.sql`.
 */

import type { IndexableType } from 'dexie';
import { reviveScheduling } from '../backup/backup';
import type { SyncTable, Tombstone } from '../db/flashcard-db';
import {
  SETTINGS_ID,
  type Card,
  type Deck,
  type ReviewDirection,
  type ReviewLog,
  type Scheduling,
  type Settings,
} from '../models/card.types';

export type RemoteRecord = Record<string, unknown>;
export type SyncRow = Deck | Card | Scheduling | ReviewLog | Settings;

export interface IncomingRow {
  /** Same encoding as `Tombstone.key`. */
  key: string;
  primaryKey: IndexableType;
  /** Null when the remote copy is a deletion. */
  row: SyncRow | null;
  updatedAt: number;
  serverUpdatedAt: number;
}

export const REMOTE_TABLE: Record<SyncTable, string> = {
  decks: 'decks',
  cards: 'cards',
  scheduling: 'scheduling',
  reviewLogs: 'review_logs',
  settings: 'settings',
};

export const CONFLICT_COLUMNS: Record<SyncTable, string> = {
  decks: 'user_id,id',
  cards: 'user_id,id',
  scheduling: 'user_id,card_id,direction',
  reviewLogs: 'user_id,id',
  settings: 'user_id',
};

export function localKey(table: SyncTable, row: SyncRow): string {
  if (table === 'scheduling') {
    const scheduling = row as Scheduling;
    return schedulingKey(scheduling.cardId, scheduling.direction);
  }
  if (table === 'settings') {
    return SETTINGS_ID;
  }
  return (row as Deck | Card | ReviewLog).id;
}

export function toRemote(table: SyncTable, row: SyncRow, userId: string): RemoteRecord {
  const base = { user_id: userId, updated_at: row.updatedAt ?? 0, deleted: false };

  switch (table) {
    case 'decks': {
      const deck = row as Deck;
      return {
        ...base,
        id: deck.id,
        name: deck.name,
        language: deck.language,
        production_enabled: deck.productionEnabled,
        created_at: deck.createdAt,
      };
    }
    case 'cards': {
      const card = row as Card;
      return {
        ...base,
        id: card.id,
        deck_id: card.deckId,
        term: card.term,
        sentence: card.sentence,
        reading: card.reading ?? null,
        meaning: card.meaning ?? null,
        sentence_translation: card.sentenceTranslation ?? null,
        tags: card.tags,
        created_at: card.createdAt,
      };
    }
    case 'scheduling': {
      const scheduling = row as Scheduling;
      return {
        ...base,
        card_id: scheduling.cardId,
        direction: scheduling.direction,
        due: scheduling.due,
        state: scheduling.state,
        fsrs: scheduling.fsrs,
      };
    }
    case 'reviewLogs': {
      const log = row as ReviewLog;
      return {
        ...base,
        id: log.id,
        card_id: log.cardId,
        direction: log.direction,
        rating: log.rating,
        reviewed_at: log.reviewedAt,
        elapsed_ms: log.elapsedMs,
        previous: log.previous,
      };
    }
    case 'settings': {
      const settings = row as Settings;
      return {
        ...base,
        new_cards_per_day: settings.newCardsPerDay,
        target_retention: settings.targetRetention,
      };
    }
  }
}

/** Just enough of a row to mark it deleted on the server; the other columns are nullable. */
export function tombstoneToRemote(tombstone: Tombstone, userId: string): RemoteRecord {
  const base = { user_id: userId, updated_at: tombstone.deletedAt, deleted: true };

  if (tombstone.table === 'scheduling') {
    const [cardId, direction] = JSON.parse(tombstone.key) as [string, ReviewDirection];
    return { ...base, card_id: cardId, direction };
  }
  if (tombstone.table === 'settings') {
    return base;
  }
  return { ...base, id: tombstone.key };
}

export function fromRemote(table: SyncTable, record: RemoteRecord): IncomingRow {
  const updatedAt = Number(record['updated_at'] ?? 0);
  const key = remoteKey(table, record);

  return {
    key,
    primaryKey: table === 'scheduling' ? (JSON.parse(key) as [string, string]) : key,
    row: record['deleted'] === true ? null : buildRow(table, record, updatedAt),
    updatedAt,
    serverUpdatedAt: Date.parse(String(record['server_updated_at'])) || 0,
  };
}

function remoteKey(table: SyncTable, record: RemoteRecord): string {
  if (table === 'scheduling') {
    return schedulingKey(String(record['card_id']), record['direction'] as ReviewDirection);
  }
  if (table === 'settings') {
    return SETTINGS_ID;
  }
  return String(record['id']);
}

function buildRow(table: SyncTable, record: RemoteRecord, updatedAt: number): SyncRow {
  switch (table) {
    case 'decks':
      return {
        id: String(record['id']),
        name: String(record['name'] ?? ''),
        language: String(record['language'] ?? 'zh-Hans'),
        productionEnabled: record['production_enabled'] === true,
        createdAt: Number(record['created_at'] ?? 0),
        updatedAt,
      };
    case 'cards':
      return {
        id: String(record['id']),
        deckId: String(record['deck_id'] ?? ''),
        term: String(record['term'] ?? ''),
        sentence: String(record['sentence'] ?? ''),
        reading: optionalText(record['reading']),
        meaning: optionalText(record['meaning']),
        sentenceTranslation: optionalText(record['sentence_translation']),
        tags: Array.isArray(record['tags']) ? (record['tags'] as string[]) : [],
        createdAt: Number(record['created_at'] ?? 0),
        updatedAt,
      };
    case 'scheduling':
      return {
        ...reviveScheduling({
          cardId: String(record['card_id']),
          direction: record['direction'] as ReviewDirection,
          due: Number(record['due']),
          state: Number(record['state']),
          fsrs: record['fsrs'] as Scheduling['fsrs'],
        }),
        updatedAt,
      };
    case 'reviewLogs':
      return {
        id: String(record['id']),
        cardId: String(record['card_id']),
        direction: record['direction'] as ReviewDirection,
        rating: Number(record['rating']),
        reviewedAt: Number(record['reviewed_at']),
        elapsedMs: Number(record['elapsed_ms'] ?? 0),
        previous: reviveScheduling(record['previous'] as Scheduling),
        updatedAt,
      };
    case 'settings':
      return {
        id: SETTINGS_ID,
        newCardsPerDay: Number(record['new_cards_per_day']),
        targetRetention: Number(record['target_retention']),
        // Device-local; the sync service keeps whatever this device already had.
        lastExportAt: 0,
        updatedAt,
      };
  }
}

function schedulingKey(cardId: string, direction: ReviewDirection): string {
  return JSON.stringify([cardId, direction]);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}
