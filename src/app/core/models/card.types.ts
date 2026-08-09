/**
 * Shared data model — the integration seam.
 *
 * A card carries three AUTHORED fields: `term`, `sentence`, and `usage`.
 * Everything else (reading, meaning, translation) is supporting metadata that
 * may be blank. Nothing in this file is language-specific: the same shape holds
 * a Chinese word, a Japanese verb, or a Spanish idiom, which is why any future
 * capture mechanism can be written as an input adapter producing a `Card`.
 */

import type { Card as FsrsCard } from 'ts-fsrs';

/** Register — how formal the word is. Universal enough to hold for any language. */
export type Register = 'neutral' | 'spoken' | 'formal' | 'literary' | 'slang';

export const REGISTERS: readonly Register[] = [
  'neutral',
  'spoken',
  'formal',
  'literary',
  'slang',
] as const;

/** A near-synonym you keep confusing this word with, and what separates them. */
export interface Contrast {
  /** The word being contrasted against, e.g. '忽然'. */
  with: string;
  /** What distinguishes them, e.g. '突然 can be an adjective; 忽然 is adverb-only'. */
  note: string;
}

/**
 * FIELD 3 — the intermediate→expert field.
 *
 * Past the point where meaning is the bottleneck, what's left is knowing when a
 * word makes you sound wrong: how formal it is, what it must appear alongside,
 * and which near-synonym you keep reaching for instead. Only `note` is required;
 * the structured parts are opt-in so a card is never blocked on them.
 */
export interface UsageNote {
  note: string;
  register?: Register;
  /** Words this one must travel with, e.g. ['发生事故', '发生变化']. */
  collocations: string[];
  contrasts: Contrast[];
}

export interface Deck {
  id: string;
  name: string;
  /** BCP-47-ish tag, e.g. 'zh-Hans'. Drives the `lang` attribute and font stack. */
  language: string;
  /** Whether cards in this deck are also drilled in the production direction. */
  productionEnabled: boolean;
  createdAt: number;
}

export interface Card {
  id: string;
  deckId: string;
  /** FIELD 1 — the vocab word itself. */
  term: string;
  /** FIELD 2 — a real sentence the word was met in. */
  sentence: string;
  /** FIELD 3 — see UsageNote. */
  usage: UsageNote;
  /** Pinyin / furigana / IPA. Deliberately named for no single language. */
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
}

/** App-wide settings. Single row, keyed by SETTINGS_ID. */
export interface Settings {
  id: string;
  /** Cap on unseen cards introduced per day, per deck. Stops an import bomb. */
  newCardsPerDay: number;
  /** FSRS target retention (0.7–0.98). Higher means shorter intervals. */
  targetRetention: number;
  /** Epoch ms of the last successful backup export, or 0 if never. */
  lastExportAt: number;
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

/** An empty field-3 value, so the editor and importers agree on the shape. */
export function emptyUsageNote(): UsageNote {
  return { note: '', collocations: [], contrasts: [] };
}
