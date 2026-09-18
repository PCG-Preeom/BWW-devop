# User Accounts & Admin Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared access code with admin-created username/password accounts, and add an admin-only overlay for managing users and locations.

**Architecture:** Netlify functions (CommonJS, `exports.handler`) are the only server layer. They call Supabase Auth and PostgREST with a server-only service-role key, and share small helpers in `netlify/lib/`. The browser keeps a session token in `localStorage` and sends it as `Authorization: Bearer` to every function. Site files are moved into `public/` so nothing else in the repo is published.

**Tech Stack:** Node 24 (`node:test`, global `fetch`), Netlify Functions (esbuild), Supabase Auth + PostgREST, vanilla JS front end (no build step).

**Spec:** `docs/superpowers/specs/2026-09-18-user-accounts-admin-design.md`

## Global Constraints

- Env var names (Netlify, server-only): `SUPABASE_DATABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. No key or project URL is ever written to a file or committed (Netlify's secret scan fails the build if it sees the URL).
- Username pattern: `^[a-z0-9._-]{3,32}$`, stored lowercase. Auth email is `<username>@pcg-map.local`.
- Password: 8–72 characters. Admin sets a temporary password; user must change it at first login (`must_change_password`).
- Login failure is always the same message: `Invalid username or password.` (wrong password, unknown user, disabled user).
- Roles are `admin` and `user` only. An admin cannot delete, disable, or demote their own account.
- Disabling a user sets `profiles.active=false` AND bans the Auth user (`ban_duration: '876000h'`); enabling sets `ban_duration: 'none'`.
- Creating a user is all-or-nothing: if the `profiles` insert fails, the Auth user is deleted again.
- `locations` requires a valid session; only admins can read inactive rows or write locations.
- Hidden UI is not the security boundary: every admin function calls `requireAdmin`.
- Functions never leak internals: unexpected errors return `500 {"error":"server_error","message":"Something went wrong."}` and log the detail.
- Existing behavior for normal users (map, sidebar tools, light/dark toggle, colors) must not change.
- Every user-visible string is rendered with `textContent`/`Node.append` (never `innerHTML`) in new UI code.

## File Structure

| File | Responsibility |
|---|---|
| `package.json` | `npm test` runs `node --test` |
| `netlify/lib/http.js` | `HttpError`, `json()`, `parseBody()`, `bearer()`, `wrap()` |
| `netlify/lib/supabase.js` | `authCall()` (Supabase Auth) and `rest()` (PostgREST, service role) |
| `netlify/lib/validate.js` | username/password/role/uuid checks, `cleanLocation()` |
| `netlify/lib/auth.js` | `requireSession()`, `requireAdmin()` |
| `netlify/functions/login.js` | POST username+password → session |
| `netlify/functions/refresh.js` | POST refresh token → new session |
| `netlify/functions/session.js` | GET current profile |
| `netlify/functions/change-password.js` | POST new password |
| `netlify/functions/locations.js` | GET locations (session required) |
| `netlify/functions/admin-users.js` | admin CRUD for users |
| `netlify/functions/admin-locations.js` | admin CRUD for locations |
| `supabase-users.sql` | create `profiles` (run before deploy) |
| `supabase-lockdown.sql` | drop public read policy and old token table (run after verifying) |
| `scripts/create-admin.js` | one-time first-admin bootstrap |
| `tests/*.test.js`, `tests/helpers.js` | server tests with mocked `fetch` |
| `public/*` | all site files (moved from repo root) |
| `public/session.js` | client session/login/refresh helper (`window.PCGSession`) |
| `public/admin.js` | admin overlay (users + locations) |

---

### Task 1: Test scaffolding and shared server helpers

**Files:**
- Create: `package.json`, `netlify/lib/http.js`, `netlify/lib/supabase.js`, `netlify/lib/validate.js`, `netlify/lib/auth.js`
- Create: `tests/helpers.js`, `tests/validate.test.js`, `tests/auth.test.js`

**Interfaces:**
- Produces (`http.js`): `class HttpError(status, code, message)`; `json(status, body)`; `parseBody(event)`; `bearer(event)`; `wrap(fn)` → Netlify handler that maps `HttpError` to `{error, message}` and other errors to 500.
- Produces (`supabase.js`): `authCall(path, {method, body, bearer, key})` where `key` is `'anon'` (default) or `'service'`; `rest(path, {method, body, prefer})`. Both resolve to `{ok, status, data}`.
- Produces (`validate.js`): `USERNAME_RE`, `cleanUsername(v)`, `toEmail(username)`, `assertUsername(v)`, `assertPassword(v)`, `assertRole(v)`, `assertUuid(v)`, `LOCATION_TYPES`, `cleanLocation(type, input, {partial})`.
- Produces (`auth.js`): `requireSession(event, {allowPasswordChange})` → `{user, profile}` where `profile = {id, username, role, active, must_change_password}`; `requireAdmin(event)`.
- Produces (`helpers.js`): `setEnv()`, `event({method, headers, body, query})`, `mockFetch(handler)` → array of recorded calls, `router(routes)`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "pcg-map",
  "private": true,
  "scripts": {
    "test": "node --test"
  }
}
```

- [ ] **Step 2: Create `tests/helpers.js`**

```js
function setEnv() {
    process.env.SUPABASE_DATABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
}

function event({ method = 'GET', headers = {}, body, query = {} } = {}) {
    return {
        httpMethod: method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        queryStringParameters: query,
    };
}

// Replaces global fetch. `handler(url, opts)` returns {status, body} (or undefined => 404).
// Returns the array of recorded calls.
function mockFetch(handler) {
    const calls = [];
    globalThis.fetch = async (url, opts = {}) => {
        calls.push({
            url: String(url),
            method: opts.method || 'GET',
            headers: opts.headers || {},
            body: opts.body ? JSON.parse(opts.body) : undefined,
        });
        const r = handler(String(url), opts) || { status: 404, body: { message: 'no route' } };
        return {
            ok: r.status >= 200 && r.status < 300,
            status: r.status,
            text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)),
        };
    };
    return calls;
}

// routes: [[method, urlSubstring, response | (url, opts) => response], ...]. First match wins.
function router(routes) {
    return (url, opts = {}) => {
        const method = opts.method || 'GET';
        for (const [m, part, resp] of routes) {
            if (m === method && url.includes(part)) {
                return typeof resp === 'function' ? resp(url, opts) : resp;
            }
        }
        return { status: 404, body: { message: `no route ${method} ${url}` } };
    };
}

module.exports = { setEnv, event, mockFetch, router };
```

- [ ] **Step 3: Write the failing validate tests — `tests/validate.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
    cleanUsername, toEmail, assertUsername, assertPassword, assertRole, assertUuid, cleanLocation,
} = require('../netlify/lib/validate');

test('usernames are lowercased, trimmed and pattern-checked', () => {
    assert.equal(assertUsername('  JSmith  '), 'jsmith');
    assert.equal(assertUsername('a.b_c-9'), 'a.b_c-9');
    for (const bad of ['ab', 'has space', 'x'.repeat(33), 'bad@name', '']) {
        assert.throws(() => assertUsername(bad), (e) => e.status === 400 && e.code === 'bad_username');
    }
});

test('cleanUsername and toEmail', () => {
    assert.equal(cleanUsername('  Bob '), 'bob');
    assert.equal(cleanUsername(undefined), '');
    assert.equal(toEmail('bob'), 'bob@pcg-map.local');
});

test('passwords must be 8-72 characters', () => {
    assert.equal(assertPassword('12345678'), '12345678');
    for (const bad of ['1234567', 'x'.repeat(73), undefined, 12345678]) {
        assert.throws(() => assertPassword(bad), (e) => e.status === 400 && e.code === 'bad_password');
    }
});

test('role and uuid checks', () => {
    assert.equal(assertRole('admin'), 'admin');
    assert.throws(() => assertRole('owner'), (e) => e.code === 'bad_role');
    assert.equal(assertUuid('11111111-1111-1111-1111-111111111111'), '11111111-1111-1111-1111-111111111111');
    assert.throws(() => assertUuid('nope'), (e) => e.code === 'bad_id');
});

test('cleanLocation builds only the columns for the type', () => {
    const mp = cleanLocation('mp', { external_id: 'MP 1', lat: '40.1', lng: '-75.2', radius_miles: '1.5', name: 'ignored' });
    assert.deepEqual(mp, { external_id: 'MP 1', lat: 40.1, lng: -75.2, radius_miles: 1.5 });

    const dunkin = cleanLocation('dunkin', {
        external_id: '9', address: '1 Main St', region: 'Bucks', lat: 40, lng: -75, combo: 'true', property_name: 'Main',
    });
    assert.deepEqual(dunkin, { external_id: '9', address: '1 Main St', region: 'Bucks', lat: 40, lng: -75, property_name: 'Main', combo: true });
});

test('cleanLocation rejects missing or invalid fields on create', () => {
    assert.throws(() => cleanLocation('mp', { lat: 1, lng: 1, radius_miles: 1 }), (e) => e.code === 'bad_field');
    assert.throws(() => cleanLocation('bww_pa', { name: 'n', address: 'a', lat: 95, lng: 0 }), (e) => e.code === 'bad_field');
    assert.throws(() => cleanLocation('nope', {}), (e) => e.code === 'bad_type');
});

test('cleanLocation partial only validates provided fields', () => {
    assert.deepEqual(cleanLocation('mp', { radius_miles: 2 }, { partial: true }), { radius_miles: 2 });
    assert.deepEqual(cleanLocation('dunkin', { property_name: '' }, { partial: true }), { property_name: null });
    assert.deepEqual(cleanLocation('mp', { active: false }, { partial: true }), { active: false });
});
```

- [ ] **Step 4: Write the failing auth tests — `tests/auth.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { setEnv, event, mockFetch, router } = require('./helpers');
const { requireSession, requireAdmin } = require('../netlify/lib/auth');

const UID = '11111111-1111-1111-1111-111111111111';
const withToken = () => event({ headers: { authorization: 'Bearer good-token' } });

function backend({ profile, userOk = true }) {
    return router([
        ['GET', '/auth/v1/user', userOk ? { status: 200, body: { id: UID } } : { status: 401, body: {} }],
        ['GET', '/rest/v1/profiles', { status: 200, body: profile ? [profile] : [] }],
    ]);
}
const profile = (over = {}) => ({ id: UID, username: 'bob', role: 'user', active: true, must_change_password: false, ...over });

test.beforeEach(setEnv);

test('rejects a missing token without calling Supabase', async () => {
    const calls = mockFetch(backend({ profile: profile() }));
    await assert.rejects(requireSession(event()), (e) => e.status === 401);
    assert.equal(calls.length, 0);
});

test('rejects an invalid token', async () => {
    mockFetch(backend({ profile: profile(), userOk: false }));
    await assert.rejects(requireSession(withToken()), (e) => e.status === 401);
});

test('rejects unknown or inactive profiles', async () => {
    mockFetch(backend({ profile: null }));
    await assert.rejects(requireSession(withToken()), (e) => e.status === 401);
    mockFetch(backend({ profile: profile({ active: false }) }));
    await assert.rejects(requireSession(withToken()), (e) => e.status === 401);
});

test('blocks users who must change their password unless allowed', async () => {
    mockFetch(backend({ profile: profile({ must_change_password: true }) }));
    await assert.rejects(requireSession(withToken()), (e) => e.status === 403 && e.code === 'password_change_required');
    const ok = await requireSession(withToken(), { allowPasswordChange: true });
    assert.equal(ok.profile.username, 'bob');
});

test('returns user and profile for a valid session', async () => {
    mockFetch(backend({ profile: profile() }));
    const s = await requireSession(withToken());
    assert.equal(s.user.id, UID);
    assert.equal(s.profile.role, 'user');
});

test('requireAdmin needs the admin role', async () => {
    mockFetch(backend({ profile: profile({ role: 'user' }) }));
    await assert.rejects(requireAdmin(withToken()), (e) => e.status === 403 && e.code === 'forbidden');
    mockFetch(backend({ profile: profile({ role: 'admin' }) }));
    assert.equal((await requireAdmin(withToken())).profile.role, 'admin');
});
```

- [ ] **Step 5: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '../netlify/lib/validate'` (and `auth`).

- [ ] **Step 6: Create `netlify/lib/http.js`**

```js
class HttpError extends Error {
    constructor(status, code, message) {
        super(message || code);
        this.status = status;
        this.code = code;
    }
}

function json(status, body) {
    return {
        statusCode: status,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
        body: JSON.stringify(body),
    };
}

function parseBody(event) {
    try {
        return JSON.parse(event.body || '{}');
    } catch {
        throw new HttpError(400, 'bad_json', 'Request body must be JSON.');
    }
}

function bearer(event) {
    const headers = event.headers || {};
    const value = headers.authorization || headers.Authorization || '';
    const match = /^Bearer (.+)$/.exec(value);
    return match ? match[1] : null;
}

function wrap(fn) {
    return async (event) => {
        try {
            return await fn(event);
        } catch (err) {
            if (err instanceof HttpError) {
                return json(err.status, { error: err.code, message: err.message });
            }
            console.error(err);
            return json(500, { error: 'server_error', message: 'Something went wrong.' });
        }
    };
}

module.exports = { HttpError, json, parseBody, bearer, wrap };
```

- [ ] **Step 7: Create `netlify/lib/supabase.js`**

```js
function need(value, name) {
    if (!value) throw new Error(`${name} is not set`);
    return value;
}

async function call(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    let data = null;
    if (text) {
        try { data = JSON.parse(text); } catch { data = text; }
    }
    return { ok: res.ok, status: res.status, data };
}

// Supabase Auth (GoTrue). key: 'anon' (default) or 'service'.
function authCall(path, { method = 'GET', body, bearer, key = 'anon' } = {}) {
    const base = need(process.env.SUPABASE_DATABASE_URL, 'SUPABASE_DATABASE_URL').replace(/\/+$/, '');
    const apikey = key === 'service'
        ? need(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY')
        : need(process.env.SUPABASE_ANON_KEY, 'SUPABASE_ANON_KEY');
    return call(`${base}/auth/v1${path}`, {
        method,
        headers: { apikey, Authorization: `Bearer ${bearer || apikey}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

// PostgREST using the service-role key (bypasses row-level security).
function rest(path, { method = 'GET', body, prefer } = {}) {
    const base = need(process.env.SUPABASE_DATABASE_URL, 'SUPABASE_DATABASE_URL').replace(/\/+$/, '');
    const key = need(process.env.SUPABASE_SERVICE_ROLE_KEY, 'SUPABASE_SERVICE_ROLE_KEY');
    const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
    if (prefer) headers.Prefer = prefer;
    return call(`${base}/rest/v1${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
    });
}

module.exports = { authCall, rest };
```

- [ ] **Step 8: Create `netlify/lib/validate.js`**

```js
const { HttpError } = require('./http');

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCATION_TYPES = ['mp', 'bww_pa', 'bww_nj', 'dunkin'];

const cleanUsername = (v) => String(v == null ? '' : v).trim().toLowerCase();
const toEmail = (username) => `${username}@pcg-map.local`;

function assertUsername(v) {
    const username = cleanUsername(v);
    if (!USERNAME_RE.test(username)) {
        throw new HttpError(400, 'bad_username', 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore.');
    }
    return username;
}

function assertPassword(v) {
    if (typeof v !== 'string' || v.length < 8 || v.length > 72) {
        throw new HttpError(400, 'bad_password', 'Password must be 8-72 characters.');
    }
    return v;
}

function assertRole(v) {
    if (v !== 'admin' && v !== 'user') throw new HttpError(400, 'bad_role', 'Role must be admin or user.');
    return v;
}

function assertUuid(v) {
    if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, 'bad_id', 'Invalid id.');
    return v;
}

const str = (min, max) => (v) => {
    const s = String(v).trim();
    if (s.length < min || s.length > max) throw new Error('length');
    return s;
};
const num = (min, max) => (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error('range');
    return n;
};
const bool = (v) => {
    if (v === true || v === 'true') return true;
    if (v === false || v === 'false') return false;
    throw new Error('bool');
};

const FIELDS = {
    external_id: { label: 'ID', parse: str(1, 40) },
    name: { label: 'Name', parse: str(1, 200) },
    address: { label: 'Address', parse: str(1, 300) },
    property_name: { label: 'Property name', parse: str(1, 200) },
    region: { label: 'Region', parse: str(1, 100) },
    lat: { label: 'Latitude', parse: num(-90, 90) },
    lng: { label: 'Longitude', parse: num(-180, 180) },
    radius_miles: { label: 'Radius', parse: num(0.01, 50) },
    combo: { label: 'Combo', parse: bool },
    active: { label: 'Active', parse: bool },
};

const REQUIRED = {
    mp: ['external_id', 'lat', 'lng', 'radius_miles'],
    bww_pa: ['name', 'address', 'lat', 'lng'],
    bww_nj: ['name', 'address', 'lat', 'lng'],
    dunkin: ['external_id', 'address', 'region', 'lat', 'lng'],
};
const OPTIONAL = {
    mp: ['active'],
    bww_pa: ['active'],
    bww_nj: ['active'],
    dunkin: ['property_name', 'combo', 'active'],
};

function cleanLocation(type, input, { partial = false } = {}) {
    if (!LOCATION_TYPES.includes(type)) throw new HttpError(400, 'bad_type', 'Unknown location type.');
    const allowed = [...REQUIRED[type], ...OPTIONAL[type]];
    const out = {};
    for (const name of allowed) {
        const value = input[name];
        const present = value !== undefined && value !== null && value !== '';
        if (!present) {
            if (name === 'property_name' && value === '') out[name] = null;
            else if (!partial && REQUIRED[type].includes(name)) {
                throw new HttpError(400, 'bad_field', `${FIELDS[name].label} is required.`);
            }
            continue;
        }
        try {
            out[name] = FIELDS[name].parse(value);
        } catch {
            throw new HttpError(400, 'bad_field', `${FIELDS[name].label} is not valid.`);
        }
    }
    return out;
}

module.exports = {
    USERNAME_RE, LOCATION_TYPES, cleanUsername, toEmail,
    assertUsername, assertPassword, assertRole, assertUuid, cleanLocation,
};
```

- [ ] **Step 9: Create `netlify/lib/auth.js`**

```js
const { HttpError, bearer } = require('./http');
const { authCall, rest } = require('./supabase');

const NOT_LOGGED_IN = () => new HttpError(401, 'unauthorized', 'Please log in.');

async function requireSession(event, { allowPasswordChange = false } = {}) {
    const token = bearer(event);
    if (!token) throw NOT_LOGGED_IN();

    const u = await authCall('/user', { bearer: token });
    if (!u.ok || !u.data || !u.data.id) throw NOT_LOGGED_IN();

    const p = await rest(`/profiles?id=eq.${encodeURIComponent(u.data.id)}&select=id,username,role,active,must_change_password&limit=1`);
    const profile = p.ok && Array.isArray(p.data) ? p.data[0] : null;
    if (!profile || !profile.active) throw NOT_LOGGED_IN();

    if (profile.must_change_password && !allowPasswordChange) {
        throw new HttpError(403, 'password_change_required', 'You must set a new password first.');
    }
    return { user: u.data, profile };
}

async function requireAdmin(event) {
    const session = await requireSession(event);
    if (session.profile.role !== 'admin') throw new HttpError(403, 'forbidden', 'Admins only.');
    return session;
}

module.exports = { requireSession, requireAdmin };
```

- [ ] **Step 10: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests in `validate.test.js` and `auth.test.js`.

- [ ] **Step 11: Commit**

```bash
git add package.json netlify/lib tests
git commit -m "feat: shared server helpers (http, supabase, validate, auth) with tests"
```

---

### Task 2: `login` and `refresh` functions

**Files:**
- Create: `netlify/functions/login.js`, `netlify/functions/refresh.js`
- Test: `tests/login.test.js`

**Interfaces:**
- Consumes: `wrap, json, parseBody, HttpError` (http.js); `authCall, rest` (supabase.js); `cleanUsername, USERNAME_RE, toEmail` (validate.js).
- Produces: `POST /.netlify/functions/login` body `{username, password}` → `200 {access_token, refresh_token, expires_at, username, role, must_change_password}` or `401 {error:'invalid_credentials', message:'Invalid username or password.'}`. `POST /.netlify/functions/refresh` body `{refresh_token}` → `200 {access_token, refresh_token, expires_at}` or `401`.

- [ ] **Step 1: Write the failing tests — `tests/login.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { setEnv, event, mockFetch, router } = require('./helpers');
const login = require('../netlify/functions/login').handler;
const refresh = require('../netlify/functions/refresh').handler;

const UID = '22222222-2222-2222-2222-222222222222';
const session = { access_token: 'a', refresh_token: 'r', expires_at: 1900000000, user: { id: UID } };
const profile = (over = {}) => ({ username: 'jsmith', role: 'user', active: true, must_change_password: true, ...over });

test.beforeEach(setEnv);

test('login succeeds and returns the session with profile flags', async () => {
    const calls = mockFetch(router([
        ['POST', '/auth/v1/token?grant_type=password', { status: 200, body: session }],
        ['GET', '/rest/v1/profiles', { status: 200, body: [profile()] }],
    ]));
    const res = await login(event({ method: 'POST', body: { username: ' JSmith ', password: 'Temp1234' } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), {
        access_token: 'a', refresh_token: 'r', expires_at: 1900000000,
        username: 'jsmith', role: 'user', must_change_password: true,
    });
    assert.equal(calls[0].body.email, 'jsmith@pcg-map.local');
});

test('wrong password returns the generic message', async () => {
    mockFetch(router([['POST', '/auth/v1/token', { status: 400, body: { error: 'invalid_grant' } }]]));
    const res = await login(event({ method: 'POST', body: { username: 'jsmith', password: 'nope' } }));
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).message, 'Invalid username or password.');
});

test('inactive users get the same generic error', async () => {
    mockFetch(router([
        ['POST', '/auth/v1/token', { status: 200, body: session }],
        ['GET', '/rest/v1/profiles', { status: 200, body: [profile({ active: false })] }],
    ]));
    const res = await login(event({ method: 'POST', body: { username: 'jsmith', password: 'Temp1234' } }));
    assert.equal(res.statusCode, 401);
    assert.equal(JSON.parse(res.body).error, 'invalid_credentials');
});

test('malformed usernames are rejected without calling Supabase', async () => {
    const calls = mockFetch(router([]));
    const res = await login(event({ method: 'POST', body: { username: 'a', password: 'Temp1234' } }));
    assert.equal(res.statusCode, 401);
    assert.equal(calls.length, 0);
});

test('login only accepts POST', async () => {
    const res = await login(event({ method: 'GET' }));
    assert.equal(res.statusCode, 405);
});

test('refresh returns a new session', async () => {
    mockFetch(router([
        ['POST', '/auth/v1/token?grant_type=refresh_token', { status: 200, body: { ...session, access_token: 'a2' } }],
        ['GET', '/rest/v1/profiles', { status: 200, body: [profile()] }],
    ]));
    const res = await refresh(event({ method: 'POST', body: { refresh_token: 'r' } }));
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).access_token, 'a2');
});

test('refresh fails for a bad token or a disabled user', async () => {
    mockFetch(router([['POST', '/auth/v1/token', { status: 400, body: {} }]]));
    assert.equal((await refresh(event({ method: 'POST', body: { refresh_token: 'x' } }))).statusCode, 401);

    mockFetch(router([
        ['POST', '/auth/v1/token', { status: 200, body: session }],
        ['GET', '/rest/v1/profiles', { status: 200, body: [profile({ active: false })] }],
    ]));
    assert.equal((await refresh(event({ method: 'POST', body: { refresh_token: 'r' } }))).statusCode, 401);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/login.test.js`
Expected: FAIL — `Cannot find module '../netlify/functions/login'`.

- [ ] **Step 3: Create `netlify/functions/login.js`**

```js
const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { authCall, rest } = require('../lib/supabase');
const { cleanUsername, USERNAME_RE, toEmail } = require('../lib/validate');

const invalid = () => new HttpError(401, 'invalid_credentials', 'Invalid username or password.');

exports.handler = wrap(async (event) => {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');

    const { username, password } = parseBody(event);
    const name = cleanUsername(username);
    if (!USERNAME_RE.test(name) || typeof password !== 'string' || !password) throw invalid();

    const auth = await authCall('/token?grant_type=password', {
        method: 'POST',
        body: { email: toEmail(name), password },
    });
    if (!auth.ok || !auth.data || !auth.data.access_token || !auth.data.user) throw invalid();

    const p = await rest(`/profiles?id=eq.${encodeURIComponent(auth.data.user.id)}&select=username,role,active,must_change_password&limit=1`);
    const profile = p.ok && Array.isArray(p.data) ? p.data[0] : null;
    if (!profile || !profile.active) throw invalid();

    return json(200, {
        access_token: auth.data.access_token,
        refresh_token: auth.data.refresh_token,
        expires_at: auth.data.expires_at,
        username: profile.username,
        role: profile.role,
        must_change_password: profile.must_change_password,
    });
});
```

- [ ] **Step 4: Create `netlify/functions/refresh.js`**

```js
const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { authCall, rest } = require('../lib/supabase');

const expired = () => new HttpError(401, 'unauthorized', 'Please log in.');

exports.handler = wrap(async (event) => {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');

    const { refresh_token } = parseBody(event);
    if (typeof refresh_token !== 'string' || !refresh_token) throw expired();

    const auth = await authCall('/token?grant_type=refresh_token', {
        method: 'POST',
        body: { refresh_token },
    });
    if (!auth.ok || !auth.data || !auth.data.access_token || !auth.data.user) throw expired();

    const p = await rest(`/profiles?id=eq.${encodeURIComponent(auth.data.user.id)}&select=active&limit=1`);
    const profile = p.ok && Array.isArray(p.data) ? p.data[0] : null;
    if (!profile || !profile.active) throw expired();

    return json(200, {
        access_token: auth.data.access_token,
        refresh_token: auth.data.refresh_token,
        expires_at: auth.data.expires_at,
    });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all tests so far.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/login.js netlify/functions/refresh.js tests/login.test.js
git commit -m "feat: login and refresh functions"
```

---

### Task 3: `session` and `change-password` functions

**Files:**
- Create: `netlify/functions/session.js`, `netlify/functions/change-password.js`
- Test: `tests/session.test.js`

**Interfaces:**
- Consumes: `requireSession` (auth.js), `assertPassword` (validate.js), `authCall`, `rest`.
- Produces: `GET /.netlify/functions/session` → `200 {username, role, must_change_password}` (works while a password change is pending). `POST /.netlify/functions/change-password` body `{new_password}` → `200 {ok:true}`; sets `must_change_password=false`.

- [ ] **Step 1: Write the failing tests — `tests/session.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { setEnv, event, mockFetch, router } = require('./helpers');
const session = require('../netlify/functions/session').handler;
const changePassword = require('../netlify/functions/change-password').handler;

const UID = '33333333-3333-3333-3333-333333333333';
const auth = { headers: { authorization: 'Bearer t' } };
const profile = (over = {}) => ({ id: UID, username: 'bob', role: 'user', active: true, must_change_password: true, ...over });
const base = (p) => [
    ['GET', '/auth/v1/user', { status: 200, body: { id: UID } }],
    ['GET', '/rest/v1/profiles', { status: 200, body: [p] }],
];

test.beforeEach(setEnv);

test('session returns the profile even while a password change is pending', async () => {
    mockFetch(router(base(profile())));
    const res = await session(event(auth));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { username: 'bob', role: 'user', must_change_password: true });
});

test('session requires a token', async () => {
    mockFetch(router(base(profile())));
    assert.equal((await session(event())).statusCode, 401);
});

test('change-password updates Auth and clears the flag', async () => {
    const calls = mockFetch(router([
        ...base(profile()),
        ['PUT', `/auth/v1/admin/users/${UID}`, { status: 200, body: {} }],
        ['PATCH', '/rest/v1/profiles', { status: 200, body: [profile({ must_change_password: false })] }],
    ]));
    const res = await changePassword(event({ ...auth, method: 'POST', body: { new_password: 'BrandNew123' } }));
    assert.equal(res.statusCode, 200);
    const put = calls.find((c) => c.method === 'PUT');
    assert.deepEqual(put.body, { password: 'BrandNew123' });
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.deepEqual(patch.body, { must_change_password: false });
});

test('change-password rejects short passwords and other methods', async () => {
    mockFetch(router(base(profile())));
    const short = await changePassword(event({ ...auth, method: 'POST', body: { new_password: 'short' } }));
    assert.equal(short.statusCode, 400);
    assert.equal((await changePassword(event({ ...auth, method: 'GET' }))).statusCode, 405);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/session.test.js`
Expected: FAIL — `Cannot find module '../netlify/functions/session'`.

- [ ] **Step 3: Create `netlify/functions/session.js`**

```js
const { HttpError, json, wrap } = require('../lib/http');
const { requireSession } = require('../lib/auth');

exports.handler = wrap(async (event) => {
    if (event.httpMethod !== 'GET') throw new HttpError(405, 'method_not_allowed', 'Use GET.');
    const { profile } = await requireSession(event, { allowPasswordChange: true });
    return json(200, {
        username: profile.username,
        role: profile.role,
        must_change_password: profile.must_change_password,
    });
});
```

- [ ] **Step 4: Create `netlify/functions/change-password.js`**

```js
const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { requireSession } = require('../lib/auth');
const { assertPassword } = require('../lib/validate');
const { authCall, rest } = require('../lib/supabase');

exports.handler = wrap(async (event) => {
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST.');

    const { user, profile } = await requireSession(event, { allowPasswordChange: true });
    const password = assertPassword(parseBody(event).new_password);

    const updated = await authCall(`/admin/users/${user.id}`, {
        method: 'PUT',
        key: 'service',
        body: { password },
    });
    if (!updated.ok) throw new Error(`Auth password update failed: ${updated.status}`);

    const flag = await rest(`/profiles?id=eq.${encodeURIComponent(profile.id)}`, {
        method: 'PATCH',
        prefer: 'return=representation',
        body: { must_change_password: false },
    });
    if (!flag.ok) throw new Error(`Profile update failed: ${flag.status}`);

    return json(200, { ok: true });
});
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add netlify/functions/session.js netlify/functions/change-password.js tests/session.test.js
git commit -m "feat: session and change-password functions"
```

---

### Task 4: `locations` function requires a session

**Files:**
- Modify: `netlify/functions/locations.js` (replace whole file)
- Test: `tests/locations.test.js`

**Interfaces:**
- Consumes: `requireSession`, `rest`, `json`, `wrap`.
- Produces: `GET /.netlify/functions/locations` → same JSON shape as today (`{mp, bwwPa, bwwNj, dunkin}`) but only with a valid, non-pending session; `exports.shapeLocations(rows)`.

- [ ] **Step 1: Write the failing tests — `tests/locations.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { setEnv, event, mockFetch, router } = require('./helpers');
const { handler, shapeLocations } = require('../netlify/functions/locations');

const UID = '44444444-4444-4444-4444-444444444444';
const auth = { headers: { authorization: 'Bearer t' } };
const profile = (over = {}) => ({ id: UID, username: 'bob', role: 'user', active: true, must_change_password: false, ...over });

const rows = [
    { type: 'mp', external_id: 'MP 1', lat: 40, lng: -75, radius_miles: 1 },
    { type: 'bww_pa', name: 'BWW A', address: '1 St', lat: 40.1, lng: -75.1 },
    { type: 'bww_nj', name: 'BWW B', address: '2 St', lat: 40.2, lng: -74.1 },
    { type: 'dunkin', external_id: '9', address: '3 St', property_name: 'Main', region: 'Bucks', lat: 40.3, lng: -75.3, combo: true },
    { type: 'dunkin', external_id: '10', address: '4 St', property_name: null, region: 'Bucks', lat: 40.4, lng: -75.4, combo: false },
];

test.beforeEach(setEnv);

test('shapeLocations keeps the existing response shape', () => {
    const data = shapeLocations(rows);
    assert.deepEqual(data.mp, [{ id: 'MP 1', lat: 40, lng: -75, radiusMiles: 1 }]);
    assert.deepEqual(data.bwwPa, [{ name: 'BWW A', address: '1 St', lat: 40.1, lng: -75.1 }]);
    assert.deepEqual(data.bwwNj, [{ name: 'BWW B', address: '2 St', lat: 40.2, lng: -74.1 }]);
    assert.deepEqual(data.dunkin[0], { id: '9', address: '3 St', propertyName: 'Main', region: 'Bucks', lat: 40.3, lng: -75.3, combo: true });
    assert.deepEqual(data.dunkin[1], { id: '10', address: '4 St', region: 'Bucks', lat: 40.4, lng: -75.4 });
});

test('locations requires a session', async () => {
    mockFetch(router([]));
    assert.equal((await handler(event())).statusCode, 401);
});

test('locations is blocked while a password change is pending', async () => {
    mockFetch(router([
        ['GET', '/auth/v1/user', { status: 200, body: { id: UID } }],
        ['GET', '/rest/v1/profiles', { status: 200, body: [profile({ must_change_password: true })] }],
    ]));
    assert.equal((await handler(event(auth))).statusCode, 403);
});

test('locations returns active rows for a valid session', async () => {
    const calls = mockFetch(router([
        ['GET', '/auth/v1/user', { status: 200, body: { id: UID } }],
        ['GET', '/rest/v1/profiles', { status: 200, body: [profile()] }],
        ['GET', '/rest/v1/locations', { status: 200, body: rows }],
    ]));
    const res = await handler(event(auth));
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).mp.length, 1);
    assert.ok(calls.some((c) => c.url.includes('/rest/v1/locations?active=eq.true')));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/locations.test.js`
Expected: FAIL — `shapeLocations is not a function` (current file only exports `handler`).

- [ ] **Step 3: Replace `netlify/functions/locations.js`**

```js
const { json, wrap } = require('../lib/http');
const { requireSession } = require('../lib/auth');
const { rest } = require('../lib/supabase');

function shapeLocations(rows) {
    return {
        mp: rows
            .filter(r => r.type === 'mp')
            .map(r => ({ id: r.external_id, lat: r.lat, lng: r.lng, radiusMiles: r.radius_miles })),
        bwwPa: rows
            .filter(r => r.type === 'bww_pa')
            .map(r => ({ name: r.name, address: r.address, lat: r.lat, lng: r.lng })),
        bwwNj: rows
            .filter(r => r.type === 'bww_nj')
            .map(r => ({ name: r.name, address: r.address, lat: r.lat, lng: r.lng })),
        dunkin: rows
            .filter(r => r.type === 'dunkin')
            .map(r => ({
                id: r.external_id,
                address: r.address,
                ...(r.property_name ? { propertyName: r.property_name } : {}),
                region: r.region,
                lat: r.lat,
                lng: r.lng,
                ...(r.combo ? { combo: true } : {}),
            })),
    };
}

exports.shapeLocations = shapeLocations;

exports.handler = wrap(async (event) => {
    await requireSession(event);

    const res = await rest('/locations?active=eq.true&order=external_id.asc&limit=1000');
    if (!res.ok) throw new Error(`Supabase error: ${res.status}`);

    return json(200, shapeLocations(res.data));
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/locations.js tests/locations.test.js
git commit -m "feat: locations endpoint requires a valid session"
```

---

### Task 5: `admin-users` function

**Files:**
- Create: `netlify/functions/admin-users.js`
- Test: `tests/admin-users.test.js`

**Interfaces:**
- Consumes: `requireAdmin`, `assertUsername/assertPassword/assertRole/assertUuid`, `toEmail`, `authCall`, `rest`.
- Produces (all admin-only):
  - `GET` → `200 {users: [{id, username, role, active, must_change_password, created_at}]}`
  - `POST {username, temp_password, role?}` → `201 {user}`; `409 username_taken`
  - `PATCH {id, role?, active?, temp_password?}` → `200 {user}`; `400 cannot_modify_self`; `404 not_found`
  - `DELETE ?id=<uuid>` → `200 {ok:true}`; `400 cannot_modify_self`

- [ ] **Step 1: Write the failing tests — `tests/admin-users.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { setEnv, event, mockFetch, router } = require('./helpers');
const { handler } = require('../netlify/functions/admin-users');

const ME = '55555555-5555-5555-5555-555555555555';
const OTHER = '66666666-6666-6666-6666-666666666666';
const auth = { headers: { authorization: 'Bearer t' } };
const me = { id: ME, username: 'boss', role: 'admin', active: true, must_change_password: false };
const other = { id: OTHER, username: 'jsmith', role: 'user', active: true, must_change_password: false, created_at: 'x' };

// Session routes come first so they win over the more general profile routes below.
const asAdmin = (extra = []) => router([
    ['GET', '/auth/v1/user', { status: 200, body: { id: ME } }],
    ['GET', `/rest/v1/profiles?id=eq.${ME}`, { status: 200, body: [me] }],
    ...extra,
]);
const req = (method, extra = {}) => event({ ...auth, method, ...extra });

test.beforeEach(setEnv);

test('non-admins are refused', async () => {
    mockFetch(router([
        ['GET', '/auth/v1/user', { status: 200, body: { id: OTHER } }],
        ['GET', '/rest/v1/profiles', { status: 200, body: [other] }],
    ]));
    assert.equal((await handler(req('GET'))).statusCode, 403);
});

test('GET lists users', async () => {
    mockFetch(asAdmin([['GET', '/rest/v1/profiles?select=', { status: 200, body: [me, other] }]]));
    const res = await handler(req('GET'));
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).users.length, 2);
});

test('POST creates the Auth user and the profile', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/profiles?username=eq.newbie', { status: 200, body: [] }],
        ['POST', '/auth/v1/admin/users', { status: 200, body: { id: OTHER } }],
        ['POST', '/rest/v1/profiles', { status: 201, body: [{ ...other, username: 'newbie' }] }],
    ]));
    const res = await handler(req('POST', { body: { username: 'Newbie', temp_password: 'Temp12345' } }));
    assert.equal(res.statusCode, 201);
    const created = calls.find((c) => c.method === 'POST' && c.url.includes('/auth/v1/admin/users'));
    assert.deepEqual(created.body, { email: 'newbie@pcg-map.local', password: 'Temp12345', email_confirm: true });
    const profile = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/profiles'));
    assert.deepEqual(profile.body, { id: OTHER, username: 'newbie', role: 'user', must_change_password: true, active: true });
});

test('POST rejects a duplicate username', async () => {
    mockFetch(asAdmin([['GET', '/rest/v1/profiles?username=eq.jsmith', { status: 200, body: [{ id: OTHER }] }]]));
    const res = await handler(req('POST', { body: { username: 'jsmith', temp_password: 'Temp12345' } }));
    assert.equal(res.statusCode, 409);
});

test('POST removes the Auth user again if the profile insert fails', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/profiles?username=eq.newbie', { status: 200, body: [] }],
        ['POST', '/auth/v1/admin/users', { status: 200, body: { id: OTHER } }],
        ['POST', '/rest/v1/profiles', { status: 500, body: { message: 'boom' } }],
        ['DELETE', `/auth/v1/admin/users/${OTHER}`, { status: 200, body: {} }],
    ]));
    const res = await handler(req('POST', { body: { username: 'newbie', temp_password: 'Temp12345' } }));
    assert.equal(res.statusCode, 500);
    assert.ok(calls.some((c) => c.method === 'DELETE' && c.url.includes(`/auth/v1/admin/users/${OTHER}`)));
});

test('POST validates username and password', async () => {
    mockFetch(asAdmin());
    assert.equal((await handler(req('POST', { body: { username: 'x', temp_password: 'Temp12345' } }))).statusCode, 400);
    assert.equal((await handler(req('POST', { body: { username: 'newbie', temp_password: 'short' } }))).statusCode, 400);
});

test('PATCH disable bans the Auth user', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', `/rest/v1/profiles?id=eq.${OTHER}`, { status: 200, body: [other] }],
        ['PUT', `/auth/v1/admin/users/${OTHER}`, { status: 200, body: {} }],
        ['PATCH', '/rest/v1/profiles', { status: 200, body: [{ ...other, active: false }] }],
    ]));
    const res = await handler(req('PATCH', { body: { id: OTHER, active: false } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { ban_duration: '876000h' });
});

test('PATCH enable lifts the ban and reset forces a password change', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', `/rest/v1/profiles?id=eq.${OTHER}`, { status: 200, body: [other] }],
        ['PUT', `/auth/v1/admin/users/${OTHER}`, { status: 200, body: {} }],
        ['PATCH', '/rest/v1/profiles', { status: 200, body: [other] }],
    ]));
    await handler(req('PATCH', { body: { id: OTHER, active: true, temp_password: 'Another123' } }));
    assert.deepEqual(calls.find((c) => c.method === 'PUT').body, { ban_duration: 'none', password: 'Another123' });
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { active: true, must_change_password: true });
});

test('PATCH cannot demote or disable yourself', async () => {
    mockFetch(asAdmin([['GET', `/rest/v1/profiles?id=eq.${ME}`, { status: 200, body: [me] }]]));
    const demote = await handler(req('PATCH', { body: { id: ME, role: 'user' } }));
    assert.equal(demote.statusCode, 400);
    assert.equal(JSON.parse(demote.body).error, 'cannot_modify_self');
    assert.equal((await handler(req('PATCH', { body: { id: ME, active: false } }))).statusCode, 400);
});

test('PATCH returns 404 for an unknown user and 400 when nothing changes', async () => {
    mockFetch(asAdmin([['GET', `/rest/v1/profiles?id=eq.${OTHER}`, { status: 200, body: [] }]]));
    assert.equal((await handler(req('PATCH', { body: { id: OTHER, role: 'admin' } }))).statusCode, 404);
    mockFetch(asAdmin([['GET', `/rest/v1/profiles?id=eq.${OTHER}`, { status: 200, body: [other] }]]));
    assert.equal((await handler(req('PATCH', { body: { id: OTHER } }))).statusCode, 400);
});

test('DELETE removes the Auth user; deleting yourself is refused', async () => {
    const calls = mockFetch(asAdmin([['DELETE', `/auth/v1/admin/users/${OTHER}`, { status: 200, body: {} }]]));
    const ok = await handler(req('DELETE', { query: { id: OTHER } }));
    assert.equal(ok.statusCode, 200);
    assert.ok(calls.some((c) => c.method === 'DELETE'));
    assert.equal((await handler(req('DELETE', { query: { id: ME } }))).statusCode, 400);
    assert.equal((await handler(req('DELETE', { query: { id: 'nope' } }))).statusCode, 400);
});

test('unsupported methods return 405', async () => {
    mockFetch(asAdmin());
    assert.equal((await handler(req('PUT'))).statusCode, 405);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/admin-users.test.js`
Expected: FAIL — `Cannot find module '../netlify/functions/admin-users'`.

- [ ] **Step 3: Create `netlify/functions/admin-users.js`**

```js
const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { requireAdmin } = require('../lib/auth');
const { authCall, rest } = require('../lib/supabase');
const { assertUsername, assertPassword, assertRole, assertUuid, toEmail } = require('../lib/validate');

const SELECT = 'id,username,role,active,must_change_password,created_at';

async function findProfile(id) {
    const r = await rest(`/profiles?id=eq.${id}&select=${SELECT}&limit=1`);
    if (!r.ok) throw new Error(`Profile lookup failed: ${r.status}`);
    return Array.isArray(r.data) && r.data[0] ? r.data[0] : null;
}

async function listUsers() {
    const r = await rest(`/profiles?select=${SELECT}&order=username.asc`);
    if (!r.ok) throw new Error(`Profile list failed: ${r.status}`);
    return json(200, { users: r.data });
}

async function createUser(event) {
    const body = parseBody(event);
    const username = assertUsername(body.username);
    const password = assertPassword(body.temp_password);
    const role = body.role === undefined ? 'user' : assertRole(body.role);

    const existing = await rest(`/profiles?username=eq.${encodeURIComponent(username)}&select=id&limit=1`);
    if (existing.ok && Array.isArray(existing.data) && existing.data.length) {
        throw new HttpError(409, 'username_taken', 'That username already exists.');
    }

    const created = await authCall('/admin/users', {
        method: 'POST',
        key: 'service',
        body: { email: toEmail(username), password, email_confirm: true },
    });
    if (!created.ok || !created.data || !created.data.id) {
        if (created.status === 422) throw new HttpError(409, 'username_taken', 'That username already exists.');
        throw new Error(`Auth create failed: ${created.status}`);
    }

    const inserted = await rest('/profiles', {
        method: 'POST',
        prefer: 'return=representation',
        body: { id: created.data.id, username, role, must_change_password: true, active: true },
    });
    if (!inserted.ok || !Array.isArray(inserted.data) || !inserted.data[0]) {
        await authCall(`/admin/users/${created.data.id}`, { method: 'DELETE', key: 'service' });
        throw new Error(`Profile insert failed: ${inserted.status}`);
    }
    return json(201, { user: inserted.data[0] });
}

async function updateUser(event, session) {
    const body = parseBody(event);
    const id = assertUuid(body.id);
    const target = await findProfile(id);
    if (!target) throw new HttpError(404, 'not_found', 'User not found.');

    const updates = {};
    const authUpdates = {};
    if (body.role !== undefined) updates.role = assertRole(body.role);
    if (body.active !== undefined) {
        if (typeof body.active !== 'boolean') throw new HttpError(400, 'bad_active', 'Active must be true or false.');
        updates.active = body.active;
        authUpdates.ban_duration = body.active ? 'none' : '876000h';
    }
    if (body.temp_password !== undefined) {
        authUpdates.password = assertPassword(body.temp_password);
        updates.must_change_password = true;
    }

    const isSelf = id === session.profile.id;
    if (isSelf && ((updates.role && updates.role !== 'admin') || updates.active === false)) {
        throw new HttpError(400, 'cannot_modify_self', 'You cannot demote or disable your own account.');
    }
    if (!Object.keys(updates).length) throw new HttpError(400, 'nothing_to_update', 'Nothing to change.');

    if (Object.keys(authUpdates).length) {
        const a = await authCall(`/admin/users/${id}`, { method: 'PUT', key: 'service', body: authUpdates });
        if (!a.ok) throw new Error(`Auth update failed: ${a.status}`);
    }

    const r = await rest(`/profiles?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: updates });
    if (!r.ok || !Array.isArray(r.data) || !r.data[0]) throw new Error(`Profile update failed: ${r.status}`);
    return json(200, { user: r.data[0] });
}

async function deleteUser(event, session) {
    const id = assertUuid((event.queryStringParameters || {}).id);
    if (id === session.profile.id) {
        throw new HttpError(400, 'cannot_modify_self', 'You cannot delete your own account.');
    }
    const r = await authCall(`/admin/users/${id}`, { method: 'DELETE', key: 'service' });
    if (!r.ok && r.status !== 404) throw new Error(`Auth delete failed: ${r.status}`);
    return json(200, { ok: true });
}

exports.handler = wrap(async (event) => {
    const session = await requireAdmin(event);
    switch (event.httpMethod) {
        case 'GET': return listUsers();
        case 'POST': return createUser(event);
        case 'PATCH': return updateUser(event, session);
        case 'DELETE': return deleteUser(event, session);
        default: throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
    }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/admin-users.js tests/admin-users.test.js
git commit -m "feat: admin-users function with self-protection and rollback"
```

---

### Task 6: `admin-locations` function

**Files:**
- Create: `netlify/functions/admin-locations.js`
- Test: `tests/admin-locations.test.js`

**Interfaces:**
- Consumes: `requireAdmin`, `cleanLocation`, `LOCATION_TYPES`, `rest`.
- Produces (all admin-only):
  - `GET [?type=mp|bww_pa|bww_nj|dunkin]` → `200 {locations: [row, ...]}` (includes inactive rows; row has `id`, `type`, all columns)
  - `POST {type, ...fields}` → `201 {location}`
  - `PATCH {id, ...fields}` → `200 {location}` (type cannot change)
  - `DELETE ?id=<integer>` → `200 {ok:true}`

- [ ] **Step 1: Write the failing tests — `tests/admin-locations.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { setEnv, event, mockFetch, router } = require('./helpers');
const { handler } = require('../netlify/functions/admin-locations');

const ME = '77777777-7777-7777-7777-777777777777';
const auth = { headers: { authorization: 'Bearer t' } };
const me = { id: ME, username: 'boss', role: 'admin', active: true, must_change_password: false };
const asAdmin = (extra = []) => router([
    ['GET', '/auth/v1/user', { status: 200, body: { id: ME } }],
    ['GET', `/rest/v1/profiles?id=eq.${ME}`, { status: 200, body: [me] }],
    ...extra,
]);
const req = (method, extra = {}) => event({ ...auth, method, ...extra });
const row = { id: 5, type: 'mp', external_id: 'MP 1', lat: 40, lng: -75, radius_miles: 1, active: true };

test.beforeEach(setEnv);

test('non-admins are refused', async () => {
    mockFetch(router([
        ['GET', '/auth/v1/user', { status: 200, body: { id: ME } }],
        ['GET', '/rest/v1/profiles', { status: 200, body: [{ ...me, role: 'user' }] }],
    ]));
    assert.equal((await handler(req('GET'))).statusCode, 403);
});

test('GET lists all rows and can filter by type', async () => {
    const calls = mockFetch(asAdmin([['GET', '/rest/v1/locations', { status: 200, body: [row] }]]));
    const res = await handler(req('GET', { query: { type: 'mp' } }));
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).locations.length, 1);
    assert.ok(calls.some((c) => c.url.includes('/rest/v1/locations') && c.url.includes('type=eq.mp')));
    assert.equal((await handler(req('GET', { query: { type: 'bogus' } }))).statusCode, 400);
});

test('POST validates and inserts with the type', async () => {
    const calls = mockFetch(asAdmin([['POST', '/rest/v1/locations', { status: 201, body: [row] }]]));
    const res = await handler(req('POST', { body: { type: 'mp', external_id: 'MP 1', lat: 40, lng: -75, radius_miles: 1 } }));
    assert.equal(res.statusCode, 201);
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/locations'));
    assert.deepEqual(insert.body, { type: 'mp', external_id: 'MP 1', lat: 40, lng: -75, radius_miles: 1 });
    const bad = await handler(req('POST', { body: { type: 'mp', lat: 40, lng: -75 } }));
    assert.equal(bad.statusCode, 400);
});

test('PATCH validates against the stored type and updates', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/locations?id=eq.5', { status: 200, body: [row] }],
        ['PATCH', '/rest/v1/locations?id=eq.5', { status: 200, body: [{ ...row, radius_miles: 2 }] }],
    ]));
    const res = await handler(req('PATCH', { body: { id: 5, radius_miles: 2, type: 'dunkin' } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { radius_miles: 2 });
});

test('PATCH returns 404 for a missing row and 400 for a bad id or empty update', async () => {
    mockFetch(asAdmin([['GET', '/rest/v1/locations?id=eq.5', { status: 200, body: [] }]]));
    assert.equal((await handler(req('PATCH', { body: { id: 5, radius_miles: 2 } }))).statusCode, 404);
    assert.equal((await handler(req('PATCH', { body: { id: 'x', radius_miles: 2 } }))).statusCode, 400);
    mockFetch(asAdmin([['GET', '/rest/v1/locations?id=eq.5', { status: 200, body: [row] }]]));
    assert.equal((await handler(req('PATCH', { body: { id: 5 } }))).statusCode, 400);
});

test('DELETE removes a row by integer id', async () => {
    const calls = mockFetch(asAdmin([['DELETE', '/rest/v1/locations?id=eq.5', { status: 204 }]]));
    assert.equal((await handler(req('DELETE', { query: { id: '5' } }))).statusCode, 200);
    assert.ok(calls.some((c) => c.method === 'DELETE'));
    assert.equal((await handler(req('DELETE', { query: { id: 'abc' } }))).statusCode, 400);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/admin-locations.test.js`
Expected: FAIL — `Cannot find module '../netlify/functions/admin-locations'`.

- [ ] **Step 3: Create `netlify/functions/admin-locations.js`**

```js
const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { requireAdmin } = require('../lib/auth');
const { rest } = require('../lib/supabase');
const { cleanLocation, LOCATION_TYPES } = require('../lib/validate');

function assertRowId(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'bad_id', 'Invalid id.');
    return n;
}

async function list(event) {
    const type = (event.queryStringParameters || {}).type;
    let path = '/locations?select=*&order=type.asc,external_id.asc,name.asc&limit=2000';
    if (type !== undefined && type !== '') {
        if (!LOCATION_TYPES.includes(type)) throw new HttpError(400, 'bad_type', 'Unknown location type.');
        path += `&type=eq.${type}`;
    }
    const r = await rest(path);
    if (!r.ok) throw new Error(`Location list failed: ${r.status}`);
    return json(200, { locations: r.data });
}

async function create(event) {
    const body = parseBody(event);
    const fields = cleanLocation(body.type, body);
    const r = await rest('/locations', {
        method: 'POST',
        prefer: 'return=representation',
        body: { type: body.type, ...fields },
    });
    if (!r.ok || !Array.isArray(r.data) || !r.data[0]) throw new Error(`Location insert failed: ${r.status}`);
    return json(201, { location: r.data[0] });
}

async function update(event) {
    const body = parseBody(event);
    const id = assertRowId(body.id);
    const existing = await rest(`/locations?id=eq.${id}&select=id,type&limit=1`);
    if (!existing.ok) throw new Error(`Location lookup failed: ${existing.status}`);
    const row = Array.isArray(existing.data) ? existing.data[0] : null;
    if (!row) throw new HttpError(404, 'not_found', 'Location not found.');

    const fields = cleanLocation(row.type, body, { partial: true });
    if (!Object.keys(fields).length) throw new HttpError(400, 'nothing_to_update', 'Nothing to change.');

    const r = await rest(`/locations?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: fields });
    if (!r.ok || !Array.isArray(r.data) || !r.data[0]) throw new Error(`Location update failed: ${r.status}`);
    return json(200, { location: r.data[0] });
}

async function remove(event) {
    const id = assertRowId((event.queryStringParameters || {}).id);
    const r = await rest(`/locations?id=eq.${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`Location delete failed: ${r.status}`);
    return json(200, { ok: true });
}

exports.handler = wrap(async (event) => {
    await requireAdmin(event);
    switch (event.httpMethod) {
        case 'GET': return list(event);
        case 'POST': return create(event);
        case 'PATCH': return update(event);
        case 'DELETE': return remove(event);
        default: throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
    }
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — the full server suite.

- [ ] **Step 5: Commit**

```bash
git add netlify/functions/admin-locations.js tests/admin-locations.test.js
git commit -m "feat: admin-locations function"
```

---

### Task 7: Database migration files and first-admin script

**Files:**
- Create: `supabase-users.sql`, `supabase-lockdown.sql`, `scripts/create-admin.js`
- Modify: `PROJECT_NOTES.md` (append an "Accounts and admin" section)

**Interfaces:**
- Consumes: `authCall`, `rest`, `assertUsername`, `assertPassword`, `toEmail`.
- Produces: `node scripts/create-admin.js <username> <temp-password>` creates the first admin (reads the three `SUPABASE_*` env vars from the shell, never from a file).

- [ ] **Step 1: Create `supabase-users.sql`**

```sql
-- ============================================================
-- PCG Map – user accounts (run in the Supabase SQL editor
-- BEFORE deploying the new login). Safe to run more than once.
-- ============================================================

CREATE TABLE IF NOT EXISTS profiles (
    id                   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username             text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9._-]{3,32}$'),
    role                 text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
    must_change_password boolean NOT NULL DEFAULT true,
    active               boolean NOT NULL DEFAULT true,
    created_at           timestamptz NOT NULL DEFAULT now()
);

-- Row-level security ON with no policies: only the service role
-- (used by the Netlify functions) can read or write profiles.
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Create `supabase-lockdown.sql`**

```sql
-- ============================================================
-- PCG Map – lock down data (run AFTER the new login works).
-- ============================================================

-- Locations are no longer readable with the public anon key.
-- (Row-level security stays enabled with no policies.)
DROP POLICY IF EXISTS "anon read active locations" ON locations;

-- The shared access code is retired.
DROP TABLE IF EXISTS access_tokens;
```

- [ ] **Step 3: Create `scripts/create-admin.js`**

```js
// One-time bootstrap: creates the first admin account.
// Usage (PowerShell):
//   $env:SUPABASE_DATABASE_URL = "https://<project-ref>.supabase.co"
//   $env:SUPABASE_ANON_KEY = "<anon key>"
//   $env:SUPABASE_SERVICE_ROLE_KEY = "<service role key>"
//   node scripts/create-admin.js <username> <temporary-password>
const { authCall, rest } = require('../netlify/lib/supabase');
const { assertUsername, assertPassword, toEmail } = require('../netlify/lib/validate');

async function main() {
    const [, , rawUsername, rawPassword] = process.argv;
    if (!rawUsername || !rawPassword) {
        console.error('Usage: node scripts/create-admin.js <username> <temporary-password>');
        process.exit(1);
    }
    const username = assertUsername(rawUsername);
    const password = assertPassword(rawPassword);

    const created = await authCall('/admin/users', {
        method: 'POST',
        key: 'service',
        body: { email: toEmail(username), password, email_confirm: true },
    });
    if (!created.ok || !created.data || !created.data.id) {
        throw new Error(`Could not create the login (status ${created.status}). Does "${username}" already exist?`);
    }

    const inserted = await rest('/profiles', {
        method: 'POST',
        prefer: 'return=representation',
        body: { id: created.data.id, username, role: 'admin', must_change_password: true, active: true },
    });
    if (!inserted.ok) {
        await authCall(`/admin/users/${created.data.id}`, { method: 'DELETE', key: 'service' });
        throw new Error(`Could not create the profile (status ${inserted.status}). Did you run supabase-users.sql?`);
    }
    console.log(`Admin "${username}" created. Log in with the temporary password; you will be asked to change it.`);
}

main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
});
```

- [ ] **Step 4: Append to `PROJECT_NOTES.md`**

```markdown

## Accounts and admin

- Users sign in with a username and password created by an admin. Passwords set by an admin are temporary; the user must change them at first login.
- Server code lives in `netlify/functions/` (endpoints) and `netlify/lib/` (shared helpers). Run the tests with `npm test`.
- Netlify environment variables (server-only): `SUPABASE_DATABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Never commit them or the project URL.
- First-time setup order: run `supabase-users.sql` in Supabase, deploy, create the first admin with `scripts/create-admin.js`, confirm login works, then run `supabase-lockdown.sql`.
- Site files live in `public/` (the only folder Netlify publishes). Local testing: `npx netlify dev`.
```

- [ ] **Step 5: Smoke-check the script's argument handling**

Run: `node scripts/create-admin.js`
Expected: prints the `Usage:` line and exits with code 1 (no network call).

- [ ] **Step 6: Commit**

```bash
git add supabase-users.sql supabase-lockdown.sql scripts/create-admin.js PROJECT_NOTES.md
git commit -m "feat: profiles migration, lockdown SQL and first-admin script"
```

---

### Task 8: Publish only site files (`public/` folder)

**Files:**
- Move (with `git mv`): `index.html`, `script.js`, `styles.css`, `icon-512.png`, `unnamed.png` → `public/`
- Delete: `data.js`, `data.json`, `netlify/functions/verify-token.js`
- Modify: `netlify.toml`, `public/index.html` (remove `data.js` script tag), `public/script.js` (remove static-data fallback)

**Interfaces:**
- Produces: Netlify publishes only `public/`; `public/script.js` `loadLocationData()` no longer has a static fallback (Task 9 rewrites it to use the session).

- [ ] **Step 1: Move site files**

```bash
mkdir public
git mv index.html script.js styles.css icon-512.png unnamed.png public/
git rm data.js data.json netlify/functions/verify-token.js
```

- [ ] **Step 2: Update `netlify.toml`**

Replace the whole file with:

```toml
[build]
  publish = "public"
  functions = "netlify/functions"

[functions]
  node_bundler = "esbuild"
```

- [ ] **Step 3: Remove the data script tag from `public/index.html`**

Delete the line `    <script src="data.js"></script>`.

- [ ] **Step 4: Remove the static fallback from `loadLocationData()` in `public/script.js`**

Replace the whole `loadLocationData` function with:

```js
async function loadLocationData() {
    const res = await fetch('/.netlify/functions/locations');
    if (!res.ok) throw new Error('Unable to load location data.');
    normalizeLocationData(await res.json());
    return true;
}
```

Also change the error text in `initializeApp()` from `'Unable to load location data. Make sure data.js is next to index.html.'` to `'Unable to load location data. Please log in again.'`.

- [ ] **Step 5: Verify nothing else references the removed files**

Run: `git grep -n "data.js\|data.json\|verify-token" -- ':!docs' ':!PROJECT_NOTES.md'`
Expected: no output (server.js may still mention paths for local serving; if it does, note it in the commit message — it is legacy local-only tooling).

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS (server tests do not depend on the moved files).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: publish only public/ and remove public copies of location data"
```

---

### Task 9: Client session helper and login / forced-password-change screens

**Files:**
- Create: `public/session.js`
- Modify: `public/index.html` (login form, password form, account bar, script tag), `public/script.js` (`setupAccessPrompt`, `loadLocationData`, remove `ACCESS_TOKEN`, `logAccessAttempt`), `public/styles.css`

**Interfaces:**
- Produces (`window.PCGSession`):
  - `login(username, password)` → resolves to `{username, role, must_change_password}`; rejects with `Error(message)`.
  - `restore()` → resolves to the stored profile after validating with `session`, or `null`.
  - `api(path, {method, body})` → parsed JSON; auto-refreshes once; rejects with `Error` having `.status` and `.code`.
  - `changePassword(newPassword)` → resolves when done and clears the pending flag.
  - `logout()` → clears tokens.
  - `user` (getter) → `{username, role, must_change_password}` or `null`.

- [ ] **Step 1: Create `public/session.js`**

```js
(function () {
    const KEY = 'pcgSession';
    const BASE = '/.netlify/functions/';
    let state = null;
    let refreshing = null;

    function load() {
        try { state = JSON.parse(localStorage.getItem(KEY)); } catch { state = null; }
        return state;
    }

    function save(next) {
        state = next;
        try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    }

    function clear() {
        state = null;
        try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
    }

    async function parse(res) {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const error = new Error(data.message || 'Request failed.');
            error.status = res.status;
            error.code = data.error;
            throw error;
        }
        return data;
    }

    async function login(username, password) {
        const data = await parse(await fetch(BASE + 'login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password }),
        }));
        save(data);
        return { username: data.username, role: data.role, must_change_password: data.must_change_password };
    }

    function refresh() {
        if (!state || !state.refresh_token) return Promise.resolve(false);
        if (!refreshing) {
            refreshing = fetch(BASE + 'refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refresh_token: state.refresh_token }),
            })
                .then(parse)
                .then((data) => { save({ ...state, ...data }); return true; })
                .catch(() => { clear(); return false; })
                .finally(() => { refreshing = null; });
        }
        return refreshing;
    }

    async function send(path, options) {
        const headers = { Authorization: 'Bearer ' + state.access_token };
        const init = { method: options.method || 'GET', headers };
        if (options.body !== undefined) {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(options.body);
        }
        return fetch(BASE + path, init);
    }

    async function api(path, options = {}) {
        if (!state && !load()) {
            const error = new Error('Please log in.');
            error.status = 401;
            throw error;
        }
        if (state.expires_at && state.expires_at - Date.now() / 1000 < 60) await refresh();
        if (!state) {
            const error = new Error('Please log in.');
            error.status = 401;
            throw error;
        }
        let res = await send(path, options);
        if (res.status === 401 && await refresh()) res = await send(path, options);
        return parse(res);
    }

    async function restore() {
        if (!load()) return null;
        try {
            const profile = await api('session');
            save({ ...state, ...profile });
            return { username: profile.username, role: profile.role, must_change_password: profile.must_change_password };
        } catch {
            clear();
            return null;
        }
    }

    async function changePassword(newPassword) {
        await api('change-password', { method: 'POST', body: { new_password: newPassword } });
        save({ ...state, must_change_password: false });
    }

    window.PCGSession = {
        login,
        restore,
        api,
        changePassword,
        logout: clear,
        get user() {
            if (!state && !load()) return null;
            return { username: state.username, role: state.role, must_change_password: state.must_change_password };
        },
    };
})();
```

- [ ] **Step 2: Replace the login form in `public/index.html`**

Replace the whole `<form class="access-panel" id="accessForm"> ... </form>` block with:

```html
        <form class="access-panel" id="accessForm">
            <div class="pcg-logo" aria-hidden="true">
                <img src="unnamed.png" alt="">
            </div>
            <h1>People Capital Group</h1>
            <label for="loginUsername">Username</label>
            <div class="access-input-row single">
                <input id="loginUsername" type="text" placeholder="Username" autocomplete="username" autocapitalize="none" spellcheck="false">
            </div>
            <label for="loginPassword">Password</label>
            <div class="access-input-row">
                <input id="loginPassword" type="password" placeholder="Password" autocomplete="current-password">
                <button type="submit" aria-label="Log in"><i class="fas fa-lock"></i></button>
            </div>
            <div id="accessMessage" class="access-message"></div>
        </form>

        <form class="access-panel" id="passwordForm" hidden>
            <div class="pcg-logo" aria-hidden="true">
                <img src="unnamed.png" alt="">
            </div>
            <h1>Set a new password</h1>
            <p class="access-note">Your password was set by an administrator. Choose a new one to continue.</p>
            <label for="newPassword">New password</label>
            <div class="access-input-row single">
                <input id="newPassword" type="password" placeholder="New password (8+ characters)" autocomplete="new-password">
            </div>
            <label for="confirmPassword">Confirm new password</label>
            <div class="access-input-row">
                <input id="confirmPassword" type="password" placeholder="Confirm new password" autocomplete="new-password">
                <button type="submit" aria-label="Save new password"><i class="fas fa-check"></i></button>
            </div>
            <div id="passwordMessage" class="access-message"></div>
        </form>
```

- [ ] **Step 3: Add the account bar at the end of the sidebar in `public/index.html`**

Immediately before `</aside>` insert:

```html
            <div class="account-bar" id="accountBar">
                <span class="account-name" id="accountName"></span>
                <button type="button" class="secondary" id="changePasswordBtn">Change password</button>
                <button type="button" class="secondary" id="logoutBtn">Log out</button>
            </div>
```

- [ ] **Step 4: Load the session script**

In `public/index.html`, replace `<script src="script.js"></script>` with:

```html
    <script src="session.js"></script>
    <script src="script.js"></script>
```

- [ ] **Step 5: Update `public/script.js`**

1. Delete the line `const ACCESS_TOKEN = 'People';`.
2. Replace `loadLocationData` with:

```js
async function loadLocationData() {
    normalizeLocationData(await PCGSession.api('locations'));
    return true;
}
```

3. Replace `unlockMap`'s first lines so it can run without the form button: keep the function as is (it already falls back to the window centre if the submit button is missing), but change `document.querySelector('#accessForm button[type="submit"]')` to `document.querySelector('.access-screen button[type="submit"]:not([hidden])')`.
4. Delete the whole `logAccessAttempt` function.
5. Replace the whole `setupAccessPrompt` function with the code below, and replace the final call `setupAccessPrompt();` with `startAuth();`:

```js
function showAccessForm(which) {
    document.getElementById('accessForm').hidden = which !== 'login';
    document.getElementById('passwordForm').hidden = which !== 'password';
    const field = which === 'login' ? 'loginUsername' : 'newPassword';
    document.getElementById(field)?.focus();
}

function enterApp(profile) {
    const name = document.getElementById('accountName');
    if (name) name.textContent = profile.username;
    document.body.classList.toggle('is-admin', profile.role === 'admin');
    unlockMap();
}

function afterLogin(profile) {
    if (profile.must_change_password) {
        showAccessForm('password');
    } else {
        enterApp(profile);
    }
}

function setupAccessPrompt() {
    const form = document.getElementById('accessForm');
    const message = document.getElementById('accessMessage');
    const submitBtn = form.querySelector('button[type="submit"]');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const username = document.getElementById('loginUsername').value.trim();
        const password = document.getElementById('loginPassword').value;
        if (!username || !password) return;

        submitBtn.disabled = true;
        message.textContent = '';
        try {
            afterLogin(await PCGSession.login(username, password));
        } catch (err) {
            message.textContent = err.message;
            document.getElementById('loginPassword').select();
        } finally {
            submitBtn.disabled = false;
        }
    });

    const passwordForm = document.getElementById('passwordForm');
    const passwordMessage = document.getElementById('passwordMessage');
    passwordForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const next = document.getElementById('newPassword').value;
        const confirm = document.getElementById('confirmPassword').value;
        passwordMessage.textContent = '';
        if (next.length < 8) { passwordMessage.textContent = 'Use at least 8 characters.'; return; }
        if (next !== confirm) { passwordMessage.textContent = 'Passwords do not match.'; return; }
        try {
            await PCGSession.changePassword(next);
            enterApp(PCGSession.user);
        } catch (err) {
            passwordMessage.textContent = err.message;
        }
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        PCGSession.logout();
        window.location.reload();
    });

    document.getElementById('changePasswordBtn').addEventListener('click', () => {
        const next = window.prompt('New password (8+ characters):');
        if (!next) return;
        PCGSession.changePassword(next)
            .then(() => window.alert('Password changed.'))
            .catch((err) => window.alert(err.message));
    });
}

async function startAuth() {
    setupAccessPrompt();
    const profile = await PCGSession.restore();
    if (profile) afterLogin(profile);
    else showAccessForm('login');
}
```

- [ ] **Step 6: Add CSS to the end of `public/styles.css`**

```css
/* Accounts: login rows, forced password change, account bar */
.access-input-row.single {
    grid-template-columns: 1fr;
    margin-bottom: 10px;
}

.access-panel[hidden] {
    display: none;
}

.access-note {
    margin: 0 0 16px;
    color: #cbd5e1;
    font-size: 13px;
}

.account-bar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 12px;
    padding: 10px 12px;
    border: 1px solid var(--line);
    border-radius: 14px;
}

.account-bar .account-name {
    flex: 1 1 100%;
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
}

.account-bar button {
    flex: 1 1 auto;
    padding: 6px 10px;
    font-size: 12px;
}
```

- [ ] **Step 7: Verify with a stubbed-backend headless preview**

Create the scratchpad file `preview-stub.html` by copying `public/index.html` and inserting, right after `<head>`, this stub (returns a normal-user session, no pending password change):

```html
<script>
window.fetch = ((real) => (url, opts) => {
  const json = (b, s = 200) => Promise.resolve(new Response(JSON.stringify(b), { status: s }));
  if (String(url).includes('/functions/login')) return json({ access_token: 'a', refresh_token: 'r', expires_at: 9999999999, username: 'demo', role: 'user', must_change_password: false });
  if (String(url).includes('/functions/session')) return json({ username: 'demo', role: 'user', must_change_password: false });
  if (String(url).includes('/functions/locations')) return json({ mp: [], bwwPa: [], bwwNj: [], dunkin: [] });
  return real(url, opts);
})(window.fetch);
</script>
```

Run headless Chrome against the copy (place it in `public/` temporarily so relative assets resolve, delete it afterwards):

```bash
"/c/Program Files/Google/Chrome/Application/chrome.exe" --headless=new --disable-gpu --window-size=1400,800 --virtual-time-budget=6000 --screenshot=login.png "file:///C:/Users/PCG-IT/Documents/Map%20Test/public/preview-stub.html"
```

Expected: `login.png` shows the black-and-gold login screen with **Username** and **Password** fields (no access-code box). Then repeat with `localStorage.setItem('pcgSession', JSON.stringify({access_token:'a',refresh_token:'r',expires_at:9999999999,username:'demo',role:'user'}))` added to the stub: the screenshot shows the map with the account bar ("demo", Change password, Log out) at the bottom of the sidebar and no admin card.

- [ ] **Step 8: Run tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add -A
git commit -m "feat: username/password login, forced password change, session handling"
```

---

### Task 10: Admin overlay (users and locations)

**Files:**
- Create: `public/admin.js`
- Modify: `public/index.html` (admin card + overlay + script tag), `public/script.js` (`refreshMapData`), `public/styles.css`

**Interfaces:**
- Consumes: `PCGSession.api`, `PCGSession.user`.
- Produces: `window.refreshMapData()` (in `script.js`) reloads location data and redraws markers; `admin.js` opens `#adminOverlay` from the `#openAdminBtn` button; the admin card is visible only when `body.is-admin`.

- [ ] **Step 1: Add the admin card to the sidebar in `public/index.html`**

Immediately before `<div class="account-bar" id="accountBar">` insert:

```html
            <details class="row tool-card admin-only">
                <summary class="section-title"><i class="fas fa-user-shield"></i><b>Admin</b></summary>
                <button type="button" class="primary" id="openAdminBtn"><i class="fas fa-users-gear"></i> Manage users &amp; locations</button>
            </details>
```

- [ ] **Step 2: Add the overlay markup before `</main>`... i.e. right before the first `<script` tag near the end of `public/index.html`**

```html
    <div id="adminOverlay" class="admin-overlay" hidden>
        <div class="admin-panel" role="dialog" aria-label="Admin">
            <div class="admin-head">
                <div class="admin-tabs">
                    <button type="button" class="admin-tab is-active" data-tab="users">Users</button>
                    <button type="button" class="admin-tab" data-tab="locations">Locations</button>
                </div>
                <button type="button" class="admin-close" id="adminClose" aria-label="Close">&times;</button>
            </div>

            <section id="adminUsers" class="admin-section">
                <form id="adminUserForm" class="admin-form">
                    <input id="newUserName" type="text" placeholder="Username" autocapitalize="none" spellcheck="false">
                    <input id="newUserPassword" type="text" placeholder="Temporary password (8+)" autocomplete="off">
                    <select id="newUserRole"><option value="user">User</option><option value="admin">Admin</option></select>
                    <button type="submit" class="primary">Add user</button>
                </form>
                <div id="adminUsersMessage" class="admin-message"></div>
                <table class="admin-table">
                    <thead><tr><th>Username</th><th>Role</th><th>Status</th><th></th></tr></thead>
                    <tbody id="adminUsersList"></tbody>
                </table>
            </section>

            <section id="adminLocations" class="admin-section" hidden>
                <div class="admin-form">
                    <select id="adminLocType">
                        <option value="">All types</option>
                        <option value="mp">MP</option>
                        <option value="bww_pa">BWW – PA</option>
                        <option value="bww_nj">BWW – NJ</option>
                        <option value="dunkin">Dunkin</option>
                    </select>
                    <select id="adminNewType">
                        <option value="mp">New MP</option>
                        <option value="bww_pa">New BWW – PA</option>
                        <option value="bww_nj">New BWW – NJ</option>
                        <option value="dunkin">New Dunkin</option>
                    </select>
                    <button type="button" class="primary" id="adminAddLoc">Add location</button>
                </div>
                <form id="adminLocForm" class="admin-form admin-loc-form" hidden></form>
                <div id="adminLocMessage" class="admin-message"></div>
                <table class="admin-table">
                    <thead><tr><th>Type</th><th>Location</th><th>Lat / Lng</th><th>Status</th><th></th></tr></thead>
                    <tbody id="adminLocList"></tbody>
                </table>
            </section>
        </div>
    </div>
```

Add `<script src="admin.js"></script>` after the `script.js` tag.

- [ ] **Step 3: Add `refreshMapData` to `public/script.js`** (after `initializeApp`)

```js
async function refreshMapData() {
    await loadLocationData();
    addMarkers();
    fillSelects();
    drawAllMPRadii();
}
window.refreshMapData = refreshMapData;
```

- [ ] **Step 4: Create `public/admin.js`**

```js
(function () {
    const $ = (id) => document.getElementById(id);

    // Builds DOM nodes safely: strings become text nodes, never HTML.
    function el(tag, props = {}, ...children) {
        const node = document.createElement(tag);
        for (const [key, value] of Object.entries(props)) {
            if (key === 'class') node.className = value;
            else if (key === 'text') node.textContent = value;
            else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
            else if (value !== false && value != null) node.setAttribute(key, value === true ? '' : value);
        }
        for (const child of children.flat()) if (child != null) node.append(child);
        return node;
    }

    const btn = (text, onclick, cls = 'secondary') => el('button', { type: 'button', class: cls, text, onclick });

    // ---------- Users ----------
    async function loadUsers() {
        const msg = $('adminUsersMessage');
        msg.textContent = '';
        try {
            const { users } = await PCGSession.api('admin-users');
            const me = PCGSession.user && PCGSession.user.username;
            $('adminUsersList').replaceChildren(...users.map((u) => userRow(u, u.username === me)));
        } catch (err) {
            msg.textContent = err.message;
        }
    }

    function userRow(u, isMe) {
        const roleSelect = el('select', { disabled: isMe, onchange: (e) => patchUser({ id: u.id, role: e.target.value }) },
            el('option', { value: 'user', text: 'User', selected: u.role === 'user' }),
            el('option', { value: 'admin', text: 'Admin', selected: u.role === 'admin' }));
        return el('tr', {},
            el('td', { text: u.username + (isMe ? ' (you)' : '') }),
            el('td', {}, roleSelect),
            el('td', { text: u.active ? (u.must_change_password ? 'Active (password pending)' : 'Active') : 'Disabled' }),
            el('td', { class: 'admin-actions' },
                btn('Reset password', () => resetPassword(u)),
                isMe ? null : btn(u.active ? 'Disable' : 'Enable', () => patchUser({ id: u.id, active: !u.active })),
                isMe ? null : btn('Delete', () => deleteUser(u), 'secondary danger')));
    }

    async function patchUser(body) {
        try {
            await PCGSession.api('admin-users', { method: 'PATCH', body });
        } catch (err) {
            $('adminUsersMessage').textContent = err.message;
        }
        loadUsers();
    }

    function resetPassword(u) {
        const temp = window.prompt(`Temporary password for ${u.username} (8+ characters). They must change it at next login:`);
        if (temp) patchUser({ id: u.id, temp_password: temp });
    }

    async function deleteUser(u) {
        if (!window.confirm(`Delete ${u.username}? This cannot be undone.`)) return;
        try {
            await PCGSession.api('admin-users?id=' + encodeURIComponent(u.id), { method: 'DELETE' });
        } catch (err) {
            $('adminUsersMessage').textContent = err.message;
        }
        loadUsers();
    }

    async function addUser(event) {
        event.preventDefault();
        const msg = $('adminUsersMessage');
        msg.textContent = '';
        try {
            await PCGSession.api('admin-users', {
                method: 'POST',
                body: {
                    username: $('newUserName').value,
                    temp_password: $('newUserPassword').value,
                    role: $('newUserRole').value,
                },
            });
            $('adminUserForm').reset();
        } catch (err) {
            msg.textContent = err.message;
        }
        loadUsers();
    }

    // ---------- Locations ----------
    const TYPE_FIELDS = {
        mp: ['external_id', 'lat', 'lng', 'radius_miles'],
        bww_pa: ['name', 'address', 'lat', 'lng'],
        bww_nj: ['name', 'address', 'lat', 'lng'],
        dunkin: ['external_id', 'address', 'property_name', 'region', 'lat', 'lng', 'combo'],
    };
    const LABELS = {
        external_id: 'ID', name: 'Name', address: 'Address', property_name: 'Property name (optional)',
        region: 'Region', lat: 'Latitude', lng: 'Longitude', radius_miles: 'Radius (miles)',
        combo: 'Dunkin / Baskin-Robbins combo',
    };
    const TYPE_NAMES = { mp: 'MP', bww_pa: 'BWW PA', bww_nj: 'BWW NJ', dunkin: 'Dunkin' };

    async function loadLocations() {
        const msg = $('adminLocMessage');
        msg.textContent = '';
        const type = $('adminLocType').value;
        try {
            const { locations } = await PCGSession.api('admin-locations' + (type ? '?type=' + type : ''));
            $('adminLocList').replaceChildren(...locations.map(locationRow));
        } catch (err) {
            msg.textContent = err.message;
        }
    }

    function locationRow(l) {
        return el('tr', { class: l.active ? '' : 'is-inactive' },
            el('td', { text: TYPE_NAMES[l.type] || l.type }),
            el('td', { text: l.external_id ? `${l.external_id}${l.address ? ' – ' + l.address : ''}` : `${l.name || ''}${l.address ? ' – ' + l.address : ''}` }),
            el('td', { text: `${l.lat}, ${l.lng}` }),
            el('td', { text: l.active ? 'Active' : 'Inactive' }),
            el('td', { class: 'admin-actions' },
                btn('Edit', () => openLocationForm(l.type, l)),
                btn(l.active ? 'Deactivate' : 'Activate', () => saveLocation('PATCH', { id: l.id, active: !l.active })),
                btn('Delete', () => deleteLocation(l), 'secondary danger')));
    }

    function openLocationForm(type, row) {
        const form = $('adminLocForm');
        form.dataset.type = type;
        form.dataset.id = row ? row.id : '';
        const fields = TYPE_FIELDS[type].map((name) => {
            if (name === 'combo') {
                return el('label', { class: 'admin-check' },
                    el('input', { type: 'checkbox', name, checked: !!(row && row.combo) }), ' ' + LABELS[name]);
            }
            return el('input', {
                type: ['lat', 'lng', 'radius_miles'].includes(name) ? 'number' : 'text',
                step: 'any', name, placeholder: LABELS[name], value: row && row[name] != null ? row[name] : '',
            });
        });
        form.replaceChildren(
            el('strong', { text: (row ? 'Edit ' : 'New ') + TYPE_NAMES[type] }),
            ...fields,
            el('button', { type: 'submit', class: 'primary', text: 'Save' }),
            btn('Cancel', () => { form.hidden = true; }));
        form.hidden = false;
    }

    async function saveLocation(method, body) {
        const msg = $('adminLocMessage');
        msg.textContent = '';
        try {
            await PCGSession.api('admin-locations', { method, body });
            $('adminLocForm').hidden = true;
            if (window.refreshMapData) await window.refreshMapData();
        } catch (err) {
            msg.textContent = err.message;
        }
        loadLocations();
    }

    function submitLocation(event) {
        event.preventDefault();
        const form = $('adminLocForm');
        const type = form.dataset.type;
        const body = {};
        for (const name of TYPE_FIELDS[type]) {
            const input = form.elements[name];
            body[name] = name === 'combo' ? input.checked : input.value;
        }
        if (form.dataset.id) saveLocation('PATCH', { id: Number(form.dataset.id), ...body });
        else saveLocation('POST', { type, ...body });
    }

    async function deleteLocation(l) {
        if (!window.confirm('Delete this location? This cannot be undone.')) return;
        try {
            await PCGSession.api('admin-locations?id=' + l.id, { method: 'DELETE' });
            if (window.refreshMapData) await window.refreshMapData();
        } catch (err) {
            $('adminLocMessage').textContent = err.message;
        }
        loadLocations();
    }

    // ---------- Overlay ----------
    function showTab(name) {
        document.querySelectorAll('.admin-tab').forEach((t) => t.classList.toggle('is-active', t.dataset.tab === name));
        $('adminUsers').hidden = name !== 'users';
        $('adminLocations').hidden = name !== 'locations';
        if (name === 'users') loadUsers(); else loadLocations();
    }

    document.addEventListener('DOMContentLoaded', () => {
        $('openAdminBtn').addEventListener('click', () => { $('adminOverlay').hidden = false; showTab('users'); });
        $('adminClose').addEventListener('click', () => { $('adminOverlay').hidden = true; });
        document.querySelectorAll('.admin-tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
        $('adminUserForm').addEventListener('submit', addUser);
        $('adminLocType').addEventListener('change', loadLocations);
        $('adminAddLoc').addEventListener('click', () => openLocationForm($('adminNewType').value, null));
        $('adminLocForm').addEventListener('submit', submitLocation);
    });
})();
```

- [ ] **Step 5: Add CSS to the end of `public/styles.css`**

```css
/* Admin */
.admin-only { display: none; }
body.is-admin .admin-only { display: block; }

.admin-overlay {
    position: fixed;
    inset: 0;
    z-index: 4000;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.55);
}

.admin-overlay[hidden] { display: none; }

.admin-panel {
    display: flex;
    flex-direction: column;
    width: min(980px, 100%);
    max-height: 90vh;
    padding: 18px;
    color: var(--text);
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: 16px;
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
    overflow: auto;
}

.admin-head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 14px;
}

.admin-tabs { display: flex; gap: 8px; }

.admin-tab {
    padding: 8px 16px;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 999px;
    cursor: pointer;
}

.admin-tab.is-active { color: #05070b; background: var(--blue); border-color: var(--blue); }

.admin-close {
    width: 36px;
    height: 36px;
    color: var(--text);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: 50%;
    font-size: 20px;
    cursor: pointer;
}

.admin-section[hidden] { display: none; }

.admin-form {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
}

.admin-form[hidden] { display: none; }
.admin-form input, .admin-form select { flex: 1 1 160px; }
.admin-check { display: flex; align-items: center; gap: 6px; flex: 1 1 100%; }
.admin-check input { flex: 0 0 auto; }

.admin-message { min-height: 18px; margin-bottom: 8px; color: #ef4444; font-size: 13px; font-weight: 700; }

.admin-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.admin-table th, .admin-table td { padding: 8px 6px; text-align: left; border-bottom: 1px solid var(--line); vertical-align: middle; }
.admin-table tr.is-inactive td { opacity: 0.55; }

.admin-actions { display: flex; flex-wrap: wrap; gap: 6px; }
.admin-actions button { padding: 4px 10px; font-size: 12px; }
.admin-actions .danger { color: #ef4444; }
```

- [ ] **Step 6: Verify with a stubbed admin preview**

Use the same stubbing approach as Task 9 Step 7 but with `role: 'admin'` in the session, and stub `admin-users` to return `{"users":[{"id":"11111111-1111-1111-1111-111111111111","username":"demo","role":"admin","active":true,"must_change_password":false,"created_at":"x"},{"id":"22222222-2222-2222-2222-222222222222","username":"jsmith","role":"user","active":true,"must_change_password":true,"created_at":"x"}]}` and `admin-locations` to return `{"locations":[{"id":1,"type":"mp","external_id":"MP 1","lat":40,"lng":-75,"radius_miles":1,"active":true}]}`. Inject a script that clicks `#openAdminBtn` after load. Screenshot in light and dark (dark by calling `setDarkMode(true,false)`).

Expected: the Admin card appears in the sidebar; the overlay shows the Users table with `demo (you)` (role select disabled, no Disable/Delete buttons) and `jsmith` (password pending) with all buttons; the Locations tab lists the MP row and "Add location" opens a form with ID / Latitude / Longitude / Radius fields. Repeat with `role: 'user'`: no Admin card is visible.

- [ ] **Step 7: Run tests and commit**

Run: `npm test`
Expected: PASS.

```bash
git add -A
git commit -m "feat: admin overlay for users and locations"
```

---

### Task 11: Version bump, full verification, and rollout

**Files:**
- Modify: `public/index.html` (version badge)

- [ ] **Step 1: Bump the version badge**

In `public/index.html` change `<div class="version-badge">v1.9</div>` to `<div class="version-badge">v2.0</div>`. Update the version note in the memory file `feedback_version_bump.md` and `MEMORY.md` to v2.0.

- [ ] **Step 2: Full test run and secret check**

Run: `npm test`
Expected: PASS — every server test.

Run: `git grep -n -i "supabase.co\|eyJhbGci\|sb_secret\|service_role" -- ':!docs' ':!PROJECT_NOTES.md' ':!tests' ':!netlify' ':!scripts'`
Expected: no output (no keys or project URL in any published or tracked site file). Also run `git grep -n "eyJhbGci"` across the whole repo and expect no output.

- [ ] **Step 3: Confirm the published folder contains only site files**

Run: `ls public`
Expected: `admin.js icon-512.png index.html script.js session.js styles.css unnamed.png`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: bump version to v2.0"
```

- [ ] **Step 5: Rollout (owner performs steps 1, 3, 5, 6; agent assists)**

1. In Supabase SQL editor, run `supabase-users.sql`.
2. Push to `devop/main` and wait for the Netlify deploy to succeed (env vars `SUPABASE_DATABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` must already be set).
3. In PowerShell, set the three env vars for the session and run `node scripts/create-admin.js <username> <temporary-password>`.
4. Open the site, log in as the new admin, set a new password, confirm the map loads and the Admin card appears.
5. In the admin overlay: create a normal test user, log in as that user in a private window (forced password change, no Admin card), then disable and delete the test user.
6. Run `supabase-lockdown.sql`; confirm the site still loads. Rotate the service-role key in Supabase and update `SUPABASE_SERVICE_ROLE_KEY` in Netlify, then redeploy.

Expected: the old shared code no longer works, and location data is only reachable with a login.
