/**
 * The scheduling layer. Wraps ts-fsrs so the algorithm never leaks into
 * components — everything above this file deals in `Scheduling` rows and
 * plain ratings.
 */

import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  Rating,
  State,
  type FSRS,
  type Grade,
} from 'ts-fsrs';
import {
  schedulingFrom,
  type ReviewDirection,
  type ReviewLog,
  type Scheduling,
} from '../models/card.types';

/** The four grades a reviewer can give, in button order. */
export const GRADES = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy] as const;

export const GRADE_LABELS: Record<Grade, string> = {
  [Rating.Again]: 'Again',
  [Rating.Hard]: 'Hard',
  [Rating.Good]: 'Good',
  [Rating.Easy]: 'Easy',
};

/** One grade button: what it's called and how far it would push the card. */
export interface GradePreview {
  rating: Grade;
  label: string;
  /** Human-readable next interval, e.g. '10m' or '4d'. */
  interval: string;
}

export function createScheduler(targetRetention: number): FSRS {
  // Fuzz is on by default and spreads due dates so reviews don't clump. Keeping
  // it means two cards graded identically can land on different days, which is
  // desirable in the app but must be disabled in tests that assert exact dates.
  return fsrs(generatorParameters({ request_retention: targetRetention }));
}

/** Fresh, never-reviewed scheduling rows for a new card. */
export function newSchedulingRows(
  cardId: string,
  directions: readonly ReviewDirection[],
  now: Date = new Date(),
): Scheduling[] {
  return directions.map((direction) => schedulingFrom(cardId, direction, createEmptyCard(now)));
}

/**
 * The four possible outcomes of grading this card, so each button can show the
 * interval it would actually produce rather than an unlabelled guess.
 */
export function preview(
  scheduler: FSRS,
  scheduling: Scheduling,
  now: Date = new Date(),
): GradePreview[] {
  const outcomes = scheduler.repeat(scheduling.fsrs, now);
  return GRADES.map((rating) => ({
    rating,
    label: GRADE_LABELS[rating],
    interval: formatInterval(now, new Date(outcomes[rating].card.due)),
  }));
}

/**
 * Applies a grade. Returns the advanced scheduling row plus a log carrying the
 * PREVIOUS row, which is what makes `undo` exact rather than approximate.
 */
export function grade(
  scheduler: FSRS,
  scheduling: Scheduling,
  rating: Grade,
  elapsedMs: number,
  now: Date = new Date(),
): { scheduling: Scheduling; log: ReviewLog } {
  const { card } = scheduler.next(scheduling.fsrs, now, rating);
  return {
    scheduling: schedulingFrom(scheduling.cardId, scheduling.direction, card),
    log: {
      id: crypto.randomUUID(),
      cardId: scheduling.cardId,
      direction: scheduling.direction,
      rating,
      reviewedAt: now.getTime(),
      elapsedMs,
      previous: scheduling,
    },
  };
}

/** True once a card has left the `New` state — i.e. it counts against the queue. */
export function isNew(scheduling: Scheduling): boolean {
  return scheduling.state === State.New;
}

/**
 * Builds a review queue: everything already due, plus a capped number of unseen
 * cards. The cap exists so that adding 200 cards in one sitting doesn't detonate
 * the following morning's session.
 */
export function buildQueue(
  rows: readonly Scheduling[],
  newCardsPerDay: number,
  now: number = Date.now(),
): Scheduling[] {
  const due: Scheduling[] = [];
  const fresh: Scheduling[] = [];

  for (const row of rows) {
    if (isNew(row)) {
      fresh.push(row);
    } else if (row.due <= now) {
      due.push(row);
    }
  }

  // Oldest-due first: the most overdue card is the one closest to being lost.
  due.sort((a, b) => a.due - b.due);

  return [...due, ...fresh.slice(0, Math.max(0, newCardsPerDay))];
}

/**
 * The production prompt: the sentence with the term masked out.
 *
 * Plain string replacement — no segmentation, no language assumptions. Every
 * occurrence is masked, because leaving a second copy visible gives the answer
 * away. If the term does not literally appear (inflected languages, a term
 * written differently in context) the sentence is returned untouched; the
 * editor warns about that case at authoring time rather than failing here.
 */
export const BLANK = '＿＿';

export function blankTerm(sentence: string, term: string): string {
  if (!term) {
    return sentence;
  }
  return sentence.split(term).join(BLANK);
}

/** Formats a future date as a compact relative interval for a grade button. */
export function formatInterval(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime();

  // Compared before rounding: 30s must read as '<1m', not round up to '1m'.
  if (ms < 60_000) {
    return '<1m';
  }

  const minutes = ms / 60_000;
  if (minutes < 60) {
    return `${Math.round(minutes)}m`;
  }

  const hours = minutes / 60;
  if (hours < 24) {
    return `${Math.round(hours)}h`;
  }

  // Unit switches are driven by days rather than by the converted value, so a
  // year's worth of days can't first round to '12mo'.
  const days = hours / 24;
  if (days < 30) {
    return `${Math.round(days)}d`;
  }
  if (days < 365) {
    return `${trim(days / 30.44)}mo`;
  }

  return `${trim(days / 365.25)}y`;
}

/** One decimal place, but only when it says something ('1.5' yet '2', not '2.0'). */
function trim(value: number): string {
  return value < 10 ? value.toFixed(1).replace(/\.0$/, '') : String(Math.round(value));
}
