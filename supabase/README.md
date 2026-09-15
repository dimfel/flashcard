# Setting up sync (Supabase)

DeckCard syncs through a free Supabase project that you own. Without one, the app still works, but
cards stay in the browser only and Settings says sync isn't set up.

1. **Create a project** at <https://supabase.com/dashboard>. The free tier is plenty.
2. **Create the tables.** Open SQL Editor → New query, paste all of
   `supabase/migrations/0001_init.sql`, and run it.
3. **Turn off email confirmation.**
   - Go to Authentication → Sign In / Providers → **Email**, switch off **Confirm email**, and save.
   - The app signs in with email + password and never sends an email. Without this step, Supabase
     holds each new account until a confirmation link is clicked. Its built-in sender only sends
     2 emails an hour, and only to your Supabase team's addresses, so that link may never arrive.
4. **Point the app at it.**
   - Copy the Project URL and the publishable (anon) key from Project Settings → API into
     `src/app/core/sync/supabase.config.ts`.
   - Both are meant to be public. Row-level security is what stops one account from reading
     another's rows.
5. **Create your account.** On the device that has your cards, open Settings → Account & sync.
   Enter an email and a password (6+ characters) and choose **Create account**, so your cards
   upload. On every other device, use the same email and password with **Sign in**.

No SMTP server is needed, because the app never sends email. The email is only your login name.

## How it syncs

- **IndexedDB stays the working copy.** Every screen reads and writes it, offline too.
- **Each sync pulls first, then pushes.**
  - Pull fetches rows changed on the server since the last pull (using `server_updated_at`).
  - Push sends rows changed locally since the last push (using `updatedAt`).
- **Conflicts go to the newest edit** (`updated_at`).
- **Deletes are pushed as `deleted = true`**, so other devices remove the row too.
- **Syncs run automatically:** a few seconds after an edit, when the app regains focus, and when
  the connection returns.
