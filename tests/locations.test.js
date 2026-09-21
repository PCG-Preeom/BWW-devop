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
