# User Accounts & Admin Tab — Design

Date: 2026-09-18
Status: Draft for review

## Goal

Replace the single shared access code with per-user accounts (username + password) created by an admin. Add an admin-only tab for managing users and locations. Normal users see exactly what the app shows today: the map, all sidebar tools, and the light/dark toggle.

## Decisions (agreed)

- Sign-in: **username + password**, accounts created by an admin.
- Passwords: admin sets a **temporary** password; the user **must change it at first login** and may change it later. Admin can reset.
- Admin tab in v1: **manage users** and **manage locations**. (Login activity log is out of scope.)
- Approach: **Supabase Auth** with Netlify functions as the only server layer.
- Location data becomes **login-only** and the old shared code is retired.

## Architecture

```
Browser (index.html/script.js)
   │  Authorization: Bearer <session token>
   ▼
Netlify functions ──► Supabase Auth  (passwords, sessions, bans)
   │  service-role key (server only)
   └────────────────► Supabase Postgres (profiles, locations)
```

- The browser never talks to Supabase directly and never holds the anon or service-role key.
- Supabase Auth owns password hashing, sessions, refresh tokens and login rate-limiting.
- A username `jsmith` maps to the internal Auth email `jsmith@pcg-map.local`. No real email is used, so there is no email-based password reset; admins reset passwords.

### Environment variables (Netlify, server-side only)

| Name | Purpose |
|---|---|
| `SUPABASE_DATABASE_URL` | `https://eqfohvmzwpiierqvpxud.supabase.co` |
| `SUPABASE_ANON_KEY` | Auth sign-in and token refresh calls |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin operations and profile lookups |

No key is ever written to a file or committed. The service-role key that was pasted into chat should be rotated after go-live.

## Data model

### `profiles` (new)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | equals `auth.users.id`, `ON DELETE CASCADE` |
| `username` | text UNIQUE NOT NULL | lowercase; `^[a-z0-9._-]{3,32}$` |
| `role` | text NOT NULL | `'admin'` or `'user'`, default `'user'` |
| `must_change_password` | boolean NOT NULL | default `true` |
| `active` | boolean NOT NULL | default `true` |
| `created_at` | timestamptz | default `now()` |

RLS is enabled with **no policies**: only the service role (Netlify functions) can read or write it.

### `locations` (existing)

- Drop the policy `"anon read active locations"`.
- Enable no anon or authenticated policies; all access goes through functions using the service role. Result: the anon key alone can no longer read location data.
- Schema unchanged.

### `access_tokens` (existing)

Retired. Dropped after the new login is confirmed working in production (not in the first migration).

### Bootstrap

A one-time SQL/Node script (documented, run by the owner) creates the first admin user in Supabase Auth and inserts their `profiles` row with `role='admin'` and `must_change_password=true`.

## Netlify functions

Shared helper `netlify/lib/auth.js` (outside the functions directory so it is not deployed as an endpoint):
- `requireSession(event)` — reads the Bearer token, verifies it via `GET /auth/v1/user`, loads the `profiles` row, and rejects with 401 if the token is invalid or `active=false`.
- `requireAdmin(event)` — `requireSession` plus `role='admin'`, else 403.
- Blocks users with `must_change_password=true` from everything except `change-password` and `session` (returns 403 `password_change_required`).

| Function | Method | Access | Behavior |
|---|---|---|---|
| `login` | POST `{username, password}` | public | Sign in via Auth with `username@pcg-map.local`; return `{access_token, refresh_token, expires_at, username, role, must_change_password}`. Generic error on any failure. Rejects inactive users. |
| `refresh` | POST `{refresh_token}` | public | Exchange for a new session via Auth. |
| `session` | GET | session | Return the caller's profile; used on page load to validate a stored token. |
| `change-password` | POST `{new_password}` | session | Min 8 characters; updates Auth password, sets `must_change_password=false`. |
| `locations` | GET | session | Existing response shape, now requires a valid session; active locations only. |
| `admin-users` | GET / POST / PATCH / DELETE | admin | List; create `{username, temp_password, role}`; update `{role, active, temp_password}` (reset sets `must_change_password=true`); delete. |
| `admin-locations` | GET / POST / PATCH / DELETE | admin | List all (incl. inactive) filterable by type; create; edit; set inactive; delete. Validates per-type required fields. |

Guards in `admin-users`:
- An admin cannot delete, disable, or demote their own account, so the system always retains an admin.
- Disabling a user sets `profiles.active=false` **and** bans the Auth user, so their token stops working.
- Usernames validated against the pattern above and checked for uniqueness before creation.
- Creating a user is all-or-nothing: if the `profiles` insert fails after the Auth user is created, the Auth user is deleted again.

## Front end

- **Login screen** (`index.html`): username + password fields replace the access-code box; same black and gold styling. Failed login shows one generic message.
- **Session handling** (`script.js`): store `access_token`, `refresh_token`, `expires_at` in `localStorage`. On load, call `session`; on 401 try `refresh`; otherwise show login. All function calls send `Authorization: Bearer`.
- **Forced password change:** after login, if `must_change_password` is true, show a "Set a new password" screen; the map does not load until it succeeds.
- **Header:** a logout control (client-side: the stored tokens are cleared), and a "change password" action for all users.
- **Admin tab** (sidebar card, rendered only when `role==='admin'`):
  - *Users*: table of username / role / status with create, reset password, enable/disable, change role, delete.
  - *Locations*: list with type filter; add / edit / deactivate / delete form with fields per type (MP: id, lat, lng, radius; BWW: name, address, lat, lng, PA/NJ; Dunkin: id, address, property name, region, lat, lng, combo). Saving reloads map data.
- Hidden UI is not the security boundary; the server enforces admin-only access on every admin function.
- The existing light/dark toggle and all current tools are unchanged for every role.

## Removed / changed

- `verify-token` function and the shared-code flow are removed from the client.
- `data.js` and `data.json` (public copies of the location data) are removed from the deployed site so the data is not readable without logging in. Note: they remain in git history.
- The local `server.js` does not implement the new functions; local development uses `netlify dev`.
- The `/api/access-log` call and IP warning are untouched by this work.

## Error handling

- Login: one generic "Invalid username or password" for wrong credentials, unknown user, and disabled user (no user enumeration). Supabase rate-limits repeated failures.
- Expired session: refresh once; if that fails, return to login.
- Admin actions: validation errors return 400 with a readable message; permission errors 403; the admin UI shows the message inline.
- Supabase unreachable: 500 with a generic message; details go to function logs only.

## Testing

- Unit tests for `requireSession` / `requireAdmin` and each function using a mocked Supabase (login success/failure, inactive user, must-change-password gating, admin-only enforcement, self-delete/demote guards, username validation).
- Headless-browser checks of the login screen, forced password change, admin tab visibility for admin vs. user, and light/dark theme unchanged.
- Manual acceptance on Netlify: one admin login and one normal-user login, create/disable/reset a test user, add and remove a test location.

## Rollout order

1. Run SQL migration (create `profiles`, drop the anon locations policy) and the bootstrap admin script.
2. Deploy functions and front end together.
3. Verify admin and normal-user login; verify old shared code no longer works.
4. Drop `access_tokens`; rotate the service-role key.

## Out of scope (v1)

Login activity log, email-based password reset, self-signup, multi-factor authentication, per-user location restrictions.
