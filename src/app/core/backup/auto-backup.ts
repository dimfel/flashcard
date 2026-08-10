/**
 * Naming and retention rules for the auto-backup folder.
 *
 * Pure and dependency-free: the risky part of writing into a folder the user
 * owns is deciding what to delete, and that decision is worth testing without a
 * file system anywhere near it.
 */

import { backupFilename } from './backup';

/**
 * The one file that is always current. A fixed name rather than a dated one so
 * there is an obvious thing to re-import, and so the folder does not grow by a
 * file per save.
 */
export const LATEST_FILENAME = 'flashcards-latest.json';

/** How many dated snapshots to keep before the oldest are dropped. */
export const SNAPSHOT_LIMIT = 14;

/**
 * Matches only the dated snapshots this app writes, e.g.
 * `flashcards-2026-08-10.json`. Deliberately strict: pruning deletes whatever
 * this matches, so `flashcards-latest.json`, the user's own files, and anything
 * else sharing the folder must not match.
 */
const SNAPSHOT_PATTERN = /^flashcards-\d{4}-\d{2}-\d{2}\.json$/;

export function isSnapshotName(name: string): boolean {
  return SNAPSHOT_PATTERN.test(name);
}

/** Today's snapshot name, reusing the manual export's format so the two match. */
export function snapshotFilename(now: Date = new Date()): string {
  return backupFilename(now);
}

/**
 * The snapshots to delete, given everything currently in the folder.
 *
 * Sorts by name, which is chronological for an ISO date, and returns everything
 * past the newest `keep`. Non-snapshot entries are ignored entirely rather than
 * counted towards the limit.
 */
export function snapshotsToPrune(
  names: readonly string[],
  keep: number = SNAPSHOT_LIMIT,
): string[] {
  const snapshots = names.filter(isSnapshotName).sort();
  if (keep <= 0) {
    return snapshots;
  }
  return snapshots.slice(0, Math.max(0, snapshots.length - keep));
}
