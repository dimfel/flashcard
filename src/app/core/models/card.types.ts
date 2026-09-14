/**
 * Shared data model — the integration seam.
 *
 * This app is Chinese-only. A card carries three AUTHORED fields: `term`,
 * `sentence`, and `reading` (pinyin). The first two are typed or drawn by hand;
 * the third is derived from the term and only edited when the derivation is
 * wrong. Everything else (meaning, translation, tags) is supporting metadata
 * that may be blank.
 *
 * An earlier version carried a structured `usage` note here — register,
 * collocations and near-synonym contrasts. It was the most expensive field to
 * author and the least often filled, and it is gone as of Dexie v2; see the
 * migration in `core/db/flashcard-db.ts`.
 *
 * `updatedAt` on every synced row is stamped by `FlashcardDb` on each local
 * write, so callers never set it. It is optional in the types only because rows
 * built in memory have not been written yet.
 */

import type { Card as FsrsCard } from 'ts-fsrs';

export interface Deck {
  id: string;
  name: string;
  /**
   * BCP-47 tag, always 'zh-Hans'. Retained so existing rows and backups stay
   * readable, but nothing branches on it any more.
   *
   * @deprecated The app is Chinese-only; templates hardcode `lang="zh-Hans"`.
   */
  language: string;
  /** Whether cards in this deck are also drilled in the production direction. */
  productionEnabled: boolean;
  createdAt: number;
  updatedAt?: number;
}

export interface Card {
  id: string;
  deckId: string;
  /** FIELD 1 — the vocab word itself. */
  term: string;
  /** FIELD 2 — a real sentence the word was met in. */
  sentence: string;
  /**
   * FIELD 3 — pinyin with tone marks, e.g. 'wán gù'. Auto-derived from `term`
   * and manually overridable; optional because a card saved before the
   * derivation resolves is still a valid card.
   */
  reading?: string;
  /** Short gloss. Optional to author, but needed to self-grade recognition. */
  meaning?: string;
  sentenceTranslation?: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

/**
 * Recognising a word and producing it are different memories that decay at
 * different rates, so each gets its own independently scheduled row.
 * - `recognition` — see the term, recall what it means and how it behaves
 * - `production`  — see the sentence with the term blanked, produce the term
 */
export type ReviewDirection = 'recognition' | 'production';

export const REVIEW_DIRECTIONS: readonly ReviewDirection[] = ['recognition', 'production'] as const;

/**
 * Scheduling lives apart from card content so that reviewing never rewrites
 * what you authored, and so scheduling can be reset without losing a card.
 */
export interface Scheduling {
  cardId: string;
  direction: ReviewDirection;
  /**
   * Epoch ms, MIRRORING `fsrs.due`. Denormalised because IndexedDB cannot index
   * into a nested object, and the whole review queue is one range query on this.
   * Always write it through `schedulingFrom()` so the two cannot drift.
   */
  due: number;
  /** ts-fsrs `State`, denormalised so new-vs-due filtering avoids a full scan. */
  state: number;
  /** Opaque ts-fsrs card state. Only core/review/scheduler.ts should read inside. */
  fsrs: FsrsCard;
  updatedAt?: number;
}

export interface ReviewLog {
  id: string;
  cardId: string;
  direction: ReviewDirection;
  /** ts-fsrs `Rating`: 1 Again, 2 Hard, 3 Good, 4 Easy. */
  rating: number;
  reviewedAt: number;
  /** Milliseconds spent on the card, for stats. */
  elapsedMs: number;
  /** The scheduling row as it was BEFORE this grade, so a grade can be undone. */
  previous: Scheduling;
  updatedAt?: number;
}

/** App-wide settings. Single row, keyed by SETTINGS_ID. */
export interface Settings {
  id: string;
  /** Cap on unseen cards introduced per day, per deck. Stops an import bomb. */
  newCardsPerDay: number;
  /** FSRS target retention (0.7–0.98). Higher means shorter intervals. */
  targetRetention: number;
  /** Epoch ms of the last manual JSON export, or 0 if never. Not synced. */
  lastExportAt: number;
  updatedAt?: number;
}

export const SETTINGS_ID = 'app-settings';

export const DEFAULT_SETTINGS: Settings = {
  id: SETTINGS_ID,
  newCardsPerDay: 15,
  targetRetention: 0.9,
  lastExportAt: 0,
};

/** Keeps `due`/`state` in lockstep with the ts-fsrs blob they mirror. */
export function schedulingFrom(
  cardId: string,
  direction: ReviewDirection,
  fsrs: FsrsCard,
): Scheduling {
  return {
    cardId,
    direction,
    due: new Date(fsrs.due).getTime(),
    state: fsrs.state,
    fsrs,
  };
}
