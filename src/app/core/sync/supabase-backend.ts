import type { SupabaseClient } from '@supabase/supabase-js';
import type { SyncTable } from '../db/flashcard-db';
import { CONFLICT_COLUMNS, REMOTE_TABLE, type RemoteRecord } from './mappers';
import type { SyncBackend, SyncUser } from './sync-backend';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './supabase.config';

/** PostgREST caps a response at 1000 rows by default. */
const PAGE_SIZE = 1000;
const PUSH_BATCH = 500;

/**
 * The Supabase implementation of `SyncBackend`.
 *
 * `@supabase/supabase-js` is imported on first use rather than at module load,
 * keeping it out of every chunk that merely references this class.
 */
export class SupabaseBackend implements SyncBackend {
  readonly configured = SUPABASE_URL !== '' && SUPABASE_PUBLISHABLE_KEY !== '';

  private clientPromise?: Promise<SupabaseClient>;

  async currentUser(): Promise<SyncUser | null> {
    const { data } = await (await this.client()).auth.getSession();
    return toUser(data.session?.user);
  }

  async signIn(email: string, password: string): Promise<SyncUser> {
    const { data, error } = await (await this.client()).auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      throw error;
    }
    return requireUser(data.user);
  }

  async signUp(email: string, password: string): Promise<SyncUser> {
    const { data, error } = await (await this.client()).auth.signUp({ email, password });
    if (error) {
      throw error;
    }
    // With "Confirm email" on, Supabase creates the user but withholds the
    // session until a link is clicked — which the default sender rarely delivers.
    if (!data.session) {
      throw new Error(
        'Account created, but Supabase wants email confirmation first. Turn off "Confirm email" (Authentication → Sign In / Providers → Email), then sign in.',
      );
    }
    return requireUser(data.user);
  }

  async signOut(): Promise<void> {
    const { error } = await (await this.client()).auth.signOut({ scope: 'local' });
    if (error) {
      throw error;
    }
  }

  async pull(table: SyncTable, sinceMs: number): Promise<RemoteRecord[]> {
    const client = await this.client();
    const since = new Date(sinceMs).toISOString();
    const rows: RemoteRecord[] = [];

    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from(REMOTE_TABLE[table])
        .select('*')
        .gte('server_updated_at', since)
        .order('server_updated_at')
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        throw error;
      }
      const page = (data ?? []) as RemoteRecord[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) {
        return rows;
      }
    }
  }

  async push(table: SyncTable, records: RemoteRecord[]): Promise<void> {
    const client = await this.client();
    for (let i = 0; i < records.length; i += PUSH_BATCH) {
      const { error } = await client
        .from(REMOTE_TABLE[table])
        .upsert(records.slice(i, i + PUSH_BATCH), { onConflict: CONFLICT_COLUMNS[table] });
      if (error) {
        throw error;
      }
    }
  }

  private client(): Promise<SupabaseClient> {
    return (this.clientPromise ??= import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        // A code typed into the app, never a redirect, so there is no URL to read.
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      }),
    ));
  }
}

function requireUser(user: { id: string; email?: string } | null | undefined): SyncUser {
  const signedIn = toUser(user);
  if (!signedIn) {
    throw new Error('Sign-in did not return an account.');
  }
  return signedIn;
}

function toUser(user: { id: string; email?: string } | null | undefined): SyncUser | null {
  return user ? { id: user.id, email: user.email ?? '' } : null;
}
