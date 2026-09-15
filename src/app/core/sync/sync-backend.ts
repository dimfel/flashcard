import { InjectionToken } from '@angular/core';
import type { SyncTable } from '../db/flashcard-db';
import type { RemoteRecord } from './mappers';
import { SupabaseBackend } from './supabase-backend';

export interface SyncUser {
  id: string;
  email: string;
}

/** Everything sync needs from the server, so specs can run against an in-memory fake. */
export interface SyncBackend {
  readonly configured: boolean;
  /** The signed-in user from a persisted session, without a network call. */
  currentUser(): Promise<SyncUser | null>;
  signIn(email: string, password: string): Promise<SyncUser>;
  /** Creates the account and signs straight in; requires "Confirm email" to be off. */
  signUp(email: string, password: string): Promise<SyncUser>;
  signOut(): Promise<void>;
  /** Rows whose `server_updated_at` is at or after `sinceMs`, oldest first. */
  pull(table: SyncTable, sinceMs: number): Promise<RemoteRecord[]>;
  /** Upserts, keyed by `CONFLICT_COLUMNS`. */
  push(table: SyncTable, records: RemoteRecord[]): Promise<void>;
}

export const SYNC_BACKEND = new InjectionToken<SyncBackend>('SYNC_BACKEND', {
  providedIn: 'root',
  factory: () => new SupabaseBackend(),
});
