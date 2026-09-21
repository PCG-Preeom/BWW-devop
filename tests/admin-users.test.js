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
