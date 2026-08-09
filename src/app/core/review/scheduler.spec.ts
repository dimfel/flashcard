import { describe, expect, it } from 'vitest';
import { createEmptyCard, fsrs, generatorParameters, Rating, State } from 'ts-fsrs';
import { schedulingFrom, type Scheduling } from '../models/card.types';
import {
  BLANK,
  blankTerm,
  buildQueue,
  formatInterval,
  grade,
  newSchedulingRows,
  preview,
} from './scheduler';

/** Fuzz is disabled here so intervals are deterministic and assertable. */
const scheduler = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false }));

function rowAt(cardId: string, due: number, state: number): Scheduling {
  const card = createEmptyCard(new Date(due));
  return { ...schedulingFrom(cardId, 'recognition', card), due, state };
}

describe('blankTerm', () => {
  it('masks the term in the sentence', () => {
    expect(blankTerm('他顽固地拒绝了。', '顽固')).toBe(`他${BLANK}地拒绝了。`);
  });

  it('masks every occurrence, so a second copy cannot give the answer away', () => {
    expect(blankTerm('发生了什么？什么也没发生。', '发生')).toBe(
      `${BLANK}了什么？什么也没${BLANK}。`,
    );
  });

  it('returns the sentence untouched when the term does not appear', () => {
    const sentence = 'She had already left.';
    expect(blankTerm(sentence, 'leave')).toBe(sentence);
  });

  it('handles the term at both boundaries', () => {
    expect(blankTerm('顽固', '顽固')).toBe(BLANK);
    expect(blankTerm('很顽固', '顽固')).toBe(`很${BLANK}`);
    expect(blankTerm('顽固的人', '顽固')).toBe(`${BLANK}的人`);
  });

  it('returns the sentence untouched for an empty term', () => {
    expect(blankTerm('anything', '')).toBe('anything');
  });
});

describe('newSchedulingRows', () => {
  it('creates one New row per requested direction', () => {
    const rows = newSchedulingRows('card-1', ['recognition', 'production']);

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.direction)).toEqual(['recognition', 'production']);
    expect(rows.every((row) => row.state === State.New)).toBe(true);
  });

  it('keeps the denormalised due in lockstep with the fsrs blob', () => {
    const [row] = newSchedulingRows('card-1', ['recognition']);
    expect(row.due).toBe(new Date(row.fsrs.due).getTime());
  });
});

describe('buildQueue', () => {
  const now = Date.UTC(2026, 7, 9, 12, 0, 0);

  it('includes due cards and excludes future ones', () => {
    const queue = buildQueue(
      [
        rowAt('overdue', now - 86_400_000, State.Review),
        rowAt('future', now + 86_400_000, State.Review),
      ],
      15,
      now,
    );

    expect(queue.map((row) => row.cardId)).toEqual(['overdue']);
  });

  it('orders due cards most-overdue first', () => {
    const queue = buildQueue(
      [
        rowAt('recent', now - 1_000, State.Review),
        rowAt('ancient', now - 900_000, State.Review),
        rowAt('middle', now - 60_000, State.Review),
      ],
      15,
      now,
    );

    expect(queue.map((row) => row.cardId)).toEqual(['ancient', 'middle', 'recent']);
  });

  it('caps new cards at the daily limit', () => {
    const fresh = Array.from({ length: 40 }, (_, i) => rowAt(`new-${i}`, now, State.New));

    expect(buildQueue(fresh, 15, now)).toHaveLength(15);
  });

  it('never drops due cards to make room for the new-card cap', () => {
    const rows = [
      ...Array.from({ length: 30 }, (_, i) => rowAt(`due-${i}`, now - 1_000, State.Review)),
      ...Array.from({ length: 30 }, (_, i) => rowAt(`new-${i}`, now, State.New)),
    ];

    const queue = buildQueue(rows, 5, now);

    expect(queue.filter((row) => row.state === State.Review)).toHaveLength(30);
    expect(queue.filter((row) => row.state === State.New)).toHaveLength(5);
  });

  it('admits no new cards when the cap is zero', () => {
    expect(buildQueue([rowAt('new', now, State.New)], 0, now)).toEqual([]);
  });

  it('returns an empty queue for an empty deck', () => {
    expect(buildQueue([], 15, now)).toEqual([]);
  });
});

describe('grade', () => {
  const now = new Date(Date.UTC(2026, 7, 9, 12, 0, 0));

  it('advances the due date and keeps the mirror in sync', () => {
    const [row] = newSchedulingRows('card-1', ['recognition'], now);

    const result = grade(scheduler, row, Rating.Good, 3_200, now);

    expect(result.scheduling.due).toBeGreaterThan(now.getTime());
    expect(result.scheduling.due).toBe(new Date(result.scheduling.fsrs.due).getTime());
    expect(result.scheduling.state).not.toBe(State.New);
  });

  it('records the pre-grade row on the log so undo is exact', () => {
    const [row] = newSchedulingRows('card-1', ['recognition'], now);

    const result = grade(scheduler, row, Rating.Again, 1_000, now);

    expect(result.log.previous).toEqual(row);
    expect(result.log.rating).toBe(Rating.Again);
    expect(result.log.elapsedMs).toBe(1_000);
    expect(result.log.reviewedAt).toBe(now.getTime());
  });

  it('schedules Again sooner than Good', () => {
    const [row] = newSchedulingRows('card-1', ['recognition'], now);

    const again = grade(scheduler, row, Rating.Again, 0, now);
    const good = grade(scheduler, row, Rating.Good, 0, now);

    expect(again.scheduling.due).toBeLessThan(good.scheduling.due);
  });
});

describe('preview', () => {
  it('offers four ascending options labelled for the buttons', () => {
    const now = new Date(Date.UTC(2026, 7, 9, 12, 0, 0));
    const [row] = newSchedulingRows('card-1', ['recognition'], now);

    const options = preview(scheduler, row, now);

    expect(options.map((option) => option.label)).toEqual(['Again', 'Hard', 'Good', 'Easy']);
    expect(options.every((option) => option.interval.length > 0)).toBe(true);
  });
});

describe('formatInterval', () => {
  const base = new Date(Date.UTC(2026, 7, 9, 12, 0, 0));
  const after = (ms: number) => formatInterval(base, new Date(base.getTime() + ms));

  it('formats across each unit boundary', () => {
    expect(after(30_000)).toBe('<1m');
    expect(after(10 * 60_000)).toBe('10m');
    expect(after(3 * 3_600_000)).toBe('3h');
    expect(after(4 * 86_400_000)).toBe('4d');
    expect(after(90 * 86_400_000)).toBe('3mo');
    expect(after(730 * 86_400_000)).toBe('2y');
  });

  it('keeps one decimal only when it carries information', () => {
    expect(after(45 * 86_400_000)).toBe('1.5mo');
    expect(after(365 * 86_400_000)).toBe('1y');
  });
});
