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
