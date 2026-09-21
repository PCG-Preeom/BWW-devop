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
