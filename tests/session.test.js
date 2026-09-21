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
