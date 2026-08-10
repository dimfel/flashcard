import { describe, expect, it } from 'vitest';
import {
  LATEST_FILENAME,
  SNAPSHOT_LIMIT,
  isSnapshotName,
  snapshotFilename,
  snapshotsToPrune,
} from './auto-backup';

describe('isSnapshotName', () => {
  it('accepts a dated snapshot', () => {
    expect(isSnapshotName('flashcards-2026-08-10.json')).toBe(true);
  });

  it('rejects the latest file, which must never be pruned', () => {
    expect(isSnapshotName(LATEST_FILENAME)).toBe(false);
  });

  it("rejects files the app did not write, whatever else is in the user's folder", () => {
    for (const name of [
      'notes.json',
      'flashcards.json',
      'flashcards-2026-08.json',
      'flashcards-2026-08-10.json.bak',
      'my-flashcards-2026-08-10.json',
      'flashcards-2026-08-10.JSON',
    ]) {
      expect(isSnapshotName(name), name).toBe(false);
    }
  });
});

describe('snapshotFilename', () => {
  it('matches the manual export naming, so a folder reads consistently', () => {
    expect(snapshotFilename(new Date('2026-08-10T23:00:00.000Z'))).toBe(
      'flashcards-2026-08-10.json',
    );
  });

  it('produces a name it would itself recognise as a snapshot', () => {
    expect(isSnapshotName(snapshotFilename(new Date('2026-01-02T00:00:00.000Z')))).toBe(true);
  });
});

describe('snapshotsToPrune', () => {
  const days = (count: number, from = 1) =>
    Array.from({ length: count }, (_, i) => `flashcards-2026-08-${String(from + i).padStart(2, '0')}.json`);

  it('keeps everything while under the limit', () => {
    expect(snapshotsToPrune(days(5), 14)).toEqual([]);
  });

  it('drops the oldest once over the limit', () => {
    const pruned = snapshotsToPrune(days(17), 14);

    expect(pruned).toEqual([
      'flashcards-2026-08-01.json',
      'flashcards-2026-08-02.json',
      'flashcards-2026-08-03.json',
    ]);
  });

  it('never returns the latest file, even when the folder is full', () => {
    const pruned = snapshotsToPrune([...days(20), LATEST_FILENAME], 14);

    expect(pruned).not.toContain(LATEST_FILENAME);
    expect(pruned).toHaveLength(6);
  });

  it('leaves unrelated files alone and does not count them towards the limit', () => {
    const pruned = snapshotsToPrune(['taxes.json', 'photo.png', ...days(15)], 14);

    expect(pruned).toEqual(['flashcards-2026-08-01.json']);
  });

  it('sorts by date rather than by folder order', () => {
    const shuffled = [
      'flashcards-2026-08-03.json',
      'flashcards-2026-08-01.json',
      'flashcards-2026-08-02.json',
    ];

    expect(snapshotsToPrune(shuffled, 1)).toEqual([
      'flashcards-2026-08-01.json',
      'flashcards-2026-08-02.json',
    ]);
  });

  it('handles a year boundary, where string order still holds', () => {
    const names = ['flashcards-2026-12-31.json', 'flashcards-2027-01-01.json'];

    expect(snapshotsToPrune(names, 1)).toEqual(['flashcards-2026-12-31.json']);
  });

  it('prunes everything when told to keep none', () => {
    expect(snapshotsToPrune(days(3), 0)).toHaveLength(3);
  });

  it('defaults to the documented limit', () => {
    expect(snapshotsToPrune(days(SNAPSHOT_LIMIT + 1))).toHaveLength(1);
  });

  it('copes with an empty folder', () => {
    expect(snapshotsToPrune([])).toEqual([]);
  });
});
