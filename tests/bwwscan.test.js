const test = require('node:test');
const assert = require('node:assert/strict');
const { setEnv, mockFetch, router } = require('./helpers');
const { parseSitemap, prettyAddress, prettyCity, geocode, runScan, SITEMAP_URL } = require('../netlify/lib/bwwscan');

const BASE = 'https://www.buffalowildwings.com/locations/us';

function sitemap(stores) {
    const urls = [
        'https://www.buffalowildwings.com/locations/',
        `${BASE}/pa/`,
        `${BASE}/pa/easton/`,
        `${BASE}/tx/dallas/100-main-street/store-9001/`,
        ...stores.map((s) => `${BASE}/${s.state}/${s.city}/${s.addr}/store-${s.id}/`),
    ];
    return `<?xml version="1.0"?><urlset>${urls.map((u) => `<url><loc>${u}</loc></url>`).join('')}</urlset>`;
}

// 40 fake stores: ids 1000-1039, alternating PA / NJ.
function stores(n = 40) {
    return Array.from({ length: n }, (_, i) => ({
        id: String(1000 + i),
        state: i % 2 ? 'nj' : 'pa',
        city: `city-${i}`,
        addr: `${100 + i}-main-street`,
    }));
}

test.beforeEach(setEnv);

test('parseSitemap keeps only PA/NJ store pages', () => {
    const out = parseSitemap(sitemap([
        { id: '779', state: 'pa', city: 'easton', addr: '3798-dryland-way' },
        { id: '1997', state: 'nj', city: 'hainesport-nj', addr: '1520-nj-route-38-suite-5' },
    ]));
    assert.equal(out.length, 2);
    assert.deepEqual(out[0], {
        storeId: '779', state: 'pa', city: 'Easton', address: '3798 Dryland Way',
        url: `${BASE}/pa/easton/3798-dryland-way/store-779/`,
    });
    assert.equal(out[1].city, 'Hainesport');
});

test('prettyAddress and prettyCity turn URL slugs into readable text', () => {
    assert.equal(prettyAddress('3798-dryland-way'), '3798 Dryland Way');
    assert.equal(prettyAddress('970-us-22'), '970 US 22');
    assert.equal(prettyAddress('500-grandview-crossing-drive,-suite-90'), '500 Grandview Crossing Drive, Suite 90');
    assert.equal(prettyCity('cranberry-township'), 'Cranberry Township');
    assert.equal(prettyCity('hainesport-nj'), 'Hainesport');
});

test('geocode returns coordinates, strips suite text, and returns null on no match', async () => {
    const calls = mockFetch(router([
        ['GET', 'nominatim.openstreetmap.org/search', { status: 200, body: [{ lat: '40.6706', lon: '-75.2867' }] }],
    ]));
    assert.deepEqual(await geocode('1520 Nj Route 38, Suite 5', 'Hainesport', 'nj'), { lat: 40.6706, lng: -75.2867 });
    assert.ok(calls[0].url.includes('street=1520+Nj+Route+38'));
    assert.ok(!calls[0].url.toLowerCase().includes('suite'));
    assert.ok(calls[0].headers['User-Agent']);

    mockFetch(router([['GET', 'nominatim.openstreetmap.org/search', { status: 200, body: [] }]]));
    assert.equal(await geocode('1 Nowhere Rd', 'Nowhere', 'pa'), null);
    mockFetch(router([['GET', 'nominatim.openstreetmap.org/search', { status: 500, body: {} }]]));
    assert.equal(await geocode('1 Nowhere Rd', 'Nowhere', 'pa'), null);
});

test('first scan records a baseline and flags nothing', async () => {
    const calls = mockFetch(router([
        ['GET', SITEMAP_URL, { status: 200, body: sitemap(stores()) }],
        ['GET', '/rest/v1/bww_scan_stores', { status: 200, body: [] }],
        ['POST', '/rest/v1/bww_scan_stores', { status: 201, body: [] }],
        ['POST', '/rest/v1/bww_scan_runs', { status: 201, body: [] }],
    ]));
    const result = await runScan({ sleepMs: 0 });
    assert.deepEqual(result, { baseline: true, total: 40, newCount: 0, geocoded: 0 });
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('/bww_scan_stores'));
    assert.equal(insert.body.length, 40);
    assert.ok(insert.body.every((r) => r.status === 'baseline'));
    assert.ok(!calls.some((c) => c.url.includes('nominatim')));
});

test('a later scan queues only new stores as pending, geocoded', async () => {
    const all = stores(41);
    const known = all.slice(0, 40).map((s) => ({ store_id: s.id, status: 'baseline', lat: null, lng: null }));
    const calls = mockFetch(router([
        ['GET', SITEMAP_URL, { status: 200, body: sitemap(all) }],
        ['GET', '/rest/v1/bww_scan_stores', { status: 200, body: known }],
        ['GET', 'nominatim.openstreetmap.org/search', { status: 200, body: [{ lat: '40.1', lon: '-75.1' }] }],
        ['POST', '/rest/v1/bww_scan_stores', { status: 201, body: [] }],
        ['POST', '/rest/v1/bww_scan_runs', { status: 201, body: [] }],
    ]));
    const result = await runScan({ sleepMs: 0 });
    assert.deepEqual(result, { baseline: false, total: 41, newCount: 1, geocoded: 1 });
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('/bww_scan_stores'));
    assert.equal(insert.body.length, 1);
    assert.deepEqual(insert.body[0], {
        store_id: '1040', state: 'pa', city: 'City 40', address: '140 Main Street',
        source_url: `${BASE}/pa/city-40/140-main-street/store-1040/`,
        lat: 40.1, lng: -75.1, status: 'pending',
    });
});

test('a failed geocode still queues the store, without coordinates', async () => {
    const all = stores(41);
    const known = all.slice(0, 40).map((s) => ({ store_id: s.id, status: 'baseline', lat: null, lng: null }));
    const calls = mockFetch(router([
        ['GET', SITEMAP_URL, { status: 200, body: sitemap(all) }],
        ['GET', '/rest/v1/bww_scan_stores', { status: 200, body: known }],
        ['GET', 'nominatim.openstreetmap.org/search', { status: 200, body: [] }],
        ['POST', '/rest/v1/bww_scan_stores', { status: 201, body: [] }],
        ['POST', '/rest/v1/bww_scan_runs', { status: 201, body: [] }],
    ]));
    const result = await runScan({ sleepMs: 0 });
    assert.equal(result.newCount, 1);
    assert.equal(result.geocoded, 0);
    const insert = calls.find((c) => c.method === 'POST' && c.url.includes('/bww_scan_stores'));
    assert.equal(insert.body[0].lat, null);
    assert.equal(insert.body[0].lng, null);
});

test('pending stores that still lack coordinates are retried', async () => {
    const all = stores(40);
    const known = all.map((s, i) => ({ store_id: s.id, status: i === 5 ? 'pending' : 'baseline', lat: null, lng: null }));
    const calls = mockFetch(router([
        ['GET', SITEMAP_URL, { status: 200, body: sitemap(all) }],
        ['GET', '/rest/v1/bww_scan_stores', { status: 200, body: known }],
        ['GET', 'nominatim.openstreetmap.org/search', { status: 200, body: [{ lat: '39.9', lon: '-75.2' }] }],
        ['PATCH', '/rest/v1/bww_scan_stores?store_id=eq.1005', { status: 200, body: [] }],
        ['POST', '/rest/v1/bww_scan_runs', { status: 201, body: [] }],
    ]));
    const result = await runScan({ sleepMs: 0 });
    assert.equal(result.newCount, 0);
    assert.equal(result.geocoded, 1);
    const patch = calls.find((c) => c.method === 'PATCH');
    assert.deepEqual(patch.body, { lat: 39.9, lng: -75.2 });
});

test('a suspiciously small sitemap aborts without writing anything', async () => {
    const calls = mockFetch(router([
        ['GET', SITEMAP_URL, { status: 200, body: sitemap(stores(5)) }],
        ['GET', '/rest/v1/bww_scan_stores', { status: 200, body: [] }],
    ]));
    await assert.rejects(runScan({ sleepMs: 0 }), /unexpected sitemap/i);
    assert.ok(!calls.some((c) => c.method === 'POST' || c.method === 'PATCH'));
});

test('a failed sitemap download aborts', async () => {
    mockFetch(router([['GET', SITEMAP_URL, { status: 503, body: 'down' }]]));
    await assert.rejects(runScan({ sleepMs: 0 }), /sitemap/i);
});
