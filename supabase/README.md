# Setting up sync (Supabase)

DeckCard syncs through a free Supabase project that you own. Without one, the app still works, but
cards stay in the browser only and Settings says sync isn't set up.

1. **Create a project** at <https://supabase.com/dashboard>. The free tier is plenty.
2. **Create the tables.** Open SQL Editor → New query, paste all of
   `supabase/migrations/0001_init.sql`, and run it.
3. **Make sign-in emails carry a code.**
   - Go to Authentication → Emails → **Magic Link** template.
   - Put `{{ .Token }}` in the body, e.g. `Your DeckCard code is {{ .Token }}`.
   - Without this, Supabase emails a link instead of the 6-digit code the app asks for. A link
     would open in the browser rather than the installed app, which has its own storage.
   - Email sign-in is on by default (Authentication → Sign In / Providers → Email).
4. **Point the app at it.**
   - Copy the Project URL and the publishable (anon) key from Project Settings → API into
     `src/app/core/sync/supabase.config.ts`.
   - Both are meant to be public. Row-level security is what stops one account from reading
     another's rows.
5. **Sign in.** Open Settings → Account & sync on the device that has your cards and sign in first,
   so they upload. Then sign in on your other devices.

Supabase's built-in email sender is rate-limited to a few messages an hour. That's fine for one
person. For more, set up custom SMTP under Authentication → Emails.

## How it syncs

- **IndexedDB stays the working copy.** Every screen reads and writes it, offline too.
- **Each sync pulls first, then pushes.**
  - Pull fetches rows changed on the server since the last pull (using `server_updated_at`).
  - Push sends rows changed locally since the last push (using `updatedAt`).
- **Conflicts go to the newest edit** (`updated_at`).
- **Deletes are pushed as `deleted = true`**, so other devices remove the row too.
- **Syncs run automatically:** a few seconds after an edit, when the app regains focus, and when
  the connection returns.
