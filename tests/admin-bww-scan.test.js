const test = require('node:test');
const assert = require('node:assert/strict');
const { setEnv, event, mockFetch, router } = require('./helpers');
const { handler } = require('../netlify/functions/admin-bww-scan');
const { SITEMAP_URL } = require('../netlify/lib/bwwscan');

const ME = '88888888-8888-8888-8888-888888888888';
const auth = { headers: { authorization: 'Bearer t' } };
const me = { id: ME, username: 'boss', role: 'admin', active: true, must_change_password: false };
const asAdmin = (extra = []) => router([
    ['GET', '/auth/v1/user', { status: 200, body: { id: ME } }],
    ['GET', `/rest/v1/profiles?id=eq.${ME}`, { status: 200, body: [me] }],
    ...extra,
]);
const req = (method, extra = {}) => event({ ...auth, method, ...extra });

const row = (over = {}) => ({
    id: 7, store_id: '2100', state: 'pa', city: 'Easton', address: '3798 Dryland Way',
    lat: 40.6706, lng: -75.2867, status: 'pending', ...over,
});

test.beforeEach(setEnv);

test('non-admins are refused', async () => {
    mockFetch(router([
        ['GET', '/auth/v1/user', { status: 200, body: { id: ME } }],
        ['GET', '/rest/v1/profiles', { status: 200, body: [{ ...me, role: 'user' }] }],
    ]));
    assert.equal((await handler(req('GET'))).statusCode, 403);
});

test('GET returns pending stores and the last run', async () => {
    mockFetch(asAdmin([
        ['GET', '/rest/v1/bww_scan_stores?status=eq.pending', { status: 200, body: [row()] }],
        ['GET', '/rest/v1/bww_scan_runs', { status: 200, body: [{ ran_at: '2026-09-21T00:00:00Z', total: 75, new_count: 1, note: null }] }],
    ]));
    const res = await handler(req('GET'));
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.pending.length, 1);
    assert.equal(body.lastRun.total, 75);
});

test('GET works before any scan has run', async () => {
    mockFetch(asAdmin([
        ['GET', '/rest/v1/bww_scan_stores?status=eq.pending', { status: 200, body: [] }],
        ['GET', '/rest/v1/bww_scan_stores?status=eq.baseline', { status: 200, body: [] }],
        ['GET', '/rest/v1/bww_scan_runs', { status: 200, body: [] }],
    ]));
    const body = JSON.parse((await handler(req('GET'))).body);
    assert.deepEqual(body, { pending: [], lastRun: null, baselineCount: 0 });
});

test('GET reports how many baseline stores could be imported', async () => {
    mockFetch(asAdmin([
        ['GET', '/rest/v1/bww_scan_stores?status=eq.pending', { status: 200, body: [] }],
        ['GET', '/rest/v1/bww_scan_stores?status=eq.baseline', { status: 200, body: [{ id: 1 }, { id: 2 }, { id: 3 }] }],
        ['GET', '/rest/v1/bww_scan_runs', { status: 200, body: [] }],
    ]));
    assert.equal(JSON.parse((await handler(req('GET'))).body).baselineCount, 3);
});

test('import moves baseline stores to pending, skipping ones already on the map', async () => {
    const baseline = [
        { id: 1, state: 'pa', address: '3798 Dryland Way' },
        { id: 2, state: 'pa', address: '100 New Road' },
        { id: 3, state: 'nj', address: '3798 Other Street' },
    ];
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/locations?type=in.', { status: 200, body: [{ type: 'bww_pa', address: '3798 Dryland Way, Easton, PA 18045', lat: 40.6, lng: -75.3 }] }],
        ['GET', '/rest/v1/bww_scan_stores?status=eq.baseline', { status: 200, body: baseline }],
        ['PATCH', '/rest/v1/bww_scan_stores?id=in.(2,3)', { status: 200, body: [] }],
    ]));
    const res = await handler(req('POST', { body: { action: 'import_baseline' } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { imported: 2, skipped: 1 });
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { status: 'pending' });
});

test('import does nothing when there is nothing to import', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/locations?type=in.', { status: 200, body: [] }],
        ['GET', '/rest/v1/bww_scan_stores?status=eq.baseline', { status: 200, body: [] }],
    ]));
    const res = await handler(req('POST', { body: { action: 'import_baseline' } }));
    assert.deepEqual(JSON.parse(res.body), { imported: 0, skipped: 0 });
    assert.ok(!calls.some((c) => c.method === 'PATCH'));
});

test('set_coords saves coordinates on a pending store', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [row({ lat: null, lng: null })] }],
        ['PATCH', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [] }],
    ]));
    const res = await handler(req('POST', { body: { action: 'set_coords', id: 7, lat: '40.1', lng: '-75.2' } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(calls.find((c) => c.method === 'PATCH').body, { lat: 40.1, lng: -75.2 });
});

test('set_coords refuses points outside PA and NJ', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [row({ lat: null, lng: null })] }],
    ]));
    const res = await handler(req('POST', { body: { action: 'set_coords', id: 7, lat: '29.7', lng: '-95.3' } }));
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'bad_coordinates');
    assert.ok(!calls.some((c) => c.method === 'PATCH'));
});

test('approve_all adds ready stores, skips duplicates of existing pins, and marks them', async () => {
    const pending = [
        row({ id: 10, store_id: '3010', state: 'pa', city: 'Easton', address: '1 First St', lat: 40.0, lng: -75.0 }),
        row({ id: 11, store_id: '3011', state: 'nj', city: 'Brick', address: '2 Second St', lat: 40.5, lng: -74.5 }),
        row({ id: 12, store_id: '3012', state: 'pa', city: 'Erie', address: '3 Third St', lat: null, lng: null }),
    ];
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/locations?type=in.', { status: 200, body: [{ type: 'bww_pa', address: '1 First St', lat: 40.0001, lng: -75.0001 }] }],
        ['GET', '/rest/v1/bww_scan_stores?status=eq.pending', { status: 200, body: pending }],
        ['POST', '/rest/v1/locations', { status: 201, body: [{ id: 1 }] }],
        ['PATCH', '/rest/v1/bww_scan_stores?id=in.(11)', { status: 200, body: [] }],
        ['PATCH', '/rest/v1/bww_scan_stores?id=in.(10)', { status: 200, body: [] }],
    ]));
    const res = await handler(req('POST', { body: { action: 'approve_all' } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body), { approved: 1, duplicates: 1 });

    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/locations'));
    assert.deepEqual(insert.body, [{
        type: 'bww_nj', name: 'Buffalo Wild Wings - Brick', address: '2 Second St, Brick, NJ', lat: 40.5, lng: -74.5,
    }]);
    const approved = calls.find((c) => c.method === 'PATCH' && c.url.includes('id=in.(11)'));
    assert.equal(approved.body.status, 'approved');
    const duplicate = calls.find((c) => c.method === 'PATCH' && c.url.includes('id=in.(10)'));
    assert.equal(duplicate.body.status, 'rejected');
});

test('approve_all with nothing ready changes nothing', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/locations?type=in.', { status: 200, body: [] }],
        ['GET', '/rest/v1/bww_scan_stores?status=eq.pending', { status: 200, body: [row({ lat: null, lng: null })] }],
    ]));
    const res = await handler(req('POST', { body: { action: 'approve_all' } }));
    assert.deepEqual(JSON.parse(res.body), { approved: 0, duplicates: 0 });
    assert.ok(!calls.some((c) => c.method === 'POST' || c.method === 'PATCH'));
});

test('POST scan runs the scan and returns its result', async () => {
    const xml = '<urlset>' + Array.from({ length: 40 }, (_, i) =>
        `<url><loc>https://www.buffalowildwings.com/locations/us/pa/city-${i}/${100 + i}-main-street/store-${1000 + i}/</loc></url>`).join('') + '</urlset>';
    mockFetch(asAdmin([
        ['GET', SITEMAP_URL, { status: 200, body: xml }],
        ['GET', '/rest/v1/bww_scan_stores?select=', { status: 200, body: [] }],
        ['POST', '/rest/v1/bww_scan_stores', { status: 201, body: [] }],
        ['POST', '/rest/v1/bww_scan_runs', { status: 201, body: [] }],
    ]));
    const res = await handler(req('POST', { body: { action: 'scan' } }));
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).result, { baseline: true, total: 40, newCount: 0, geocoded: 0 });
});

test('approve adds a BWW location and marks the row approved', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [row()] }],
        ['POST', '/rest/v1/locations', { status: 201, body: [{ id: 99 }] }],
        ['PATCH', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [row({ status: 'approved' })] }],
    ]));
    const res = await handler(req('POST', { body: { action: 'approve', id: 7 } }));
    assert.equal(res.statusCode, 200);
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/locations'));
    assert.deepEqual(insert.body, {
        type: 'bww_pa', name: 'Buffalo Wild Wings - Easton', address: '3798 Dryland Way, Easton, PA',
        lat: 40.6706, lng: -75.2867,
    });
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.equal(patch.body.status, 'approved');
    assert.ok(patch.body.reviewed_at);
});

test('approve uses typed-in coordinates and the NJ type', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [row({ state: 'nj', lat: null, lng: null })] }],
        ['POST', '/rest/v1/locations', { status: 201, body: [{ id: 99 }] }],
        ['PATCH', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [] }],
    ]));
    const res = await handler(req('POST', { body: { action: 'approve', id: 7, lat: '40.5', lng: '-74.5' } }));
    assert.equal(res.statusCode, 200);
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('/rest/v1/locations'));
    assert.equal(insert.body.type, 'bww_nj');
    assert.equal(insert.body.lat, 40.5);
    assert.equal(insert.body.lng, -74.5);
});

test('approve without coordinates is refused and nothing is written', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [row({ lat: null, lng: null })] }],
    ]));
    const res = await handler(req('POST', { body: { action: 'approve', id: 7 } }));
    assert.equal(res.statusCode, 400);
    assert.equal(JSON.parse(res.body).error, 'needs_coordinates');
    assert.ok(!calls.some((c) => c.method === 'POST' && c.url.includes('/locations')));
});

test('approve only works on pending rows', async () => {
    mockFetch(asAdmin([['GET', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [row({ status: 'approved' })] }]]));
    assert.equal((await handler(req('POST', { body: { action: 'approve', id: 7 } }))).statusCode, 409);
    mockFetch(asAdmin([['GET', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [] }]]));
    assert.equal((await handler(req('POST', { body: { action: 'approve', id: 7 } }))).statusCode, 404);
});

test('reject marks the row rejected', async () => {
    const calls = mockFetch(asAdmin([
        ['GET', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [row()] }],
        ['PATCH', '/rest/v1/bww_scan_stores?id=eq.7', { status: 200, body: [] }],
    ]));
    const res = await handler(req('POST', { body: { action: 'reject', id: 7 } }));
    assert.equal(res.statusCode, 200);
    assert.equal(calls.find((c) => c.method === 'PATCH').body.status, 'rejected');
});

test('unknown actions and methods are refused', async () => {
    mockFetch(asAdmin());
    assert.equal((await handler(req('POST', { body: { action: 'explode' } }))).statusCode, 400);
    assert.equal((await handler(req('DELETE'))).statusCode, 405);
});
