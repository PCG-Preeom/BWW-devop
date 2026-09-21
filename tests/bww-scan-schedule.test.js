const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setEnv, mockFetch, router } = require('./helpers');
const { handler } = require('../netlify/functions/bww-scan');
const { SITEMAP_URL } = require('../netlify/lib/bwwscan');

test.beforeEach(setEnv);

test('the weekly function reports success with the scan result', async () => {
    const xml = '<urlset>' + Array.from({ length: 40 }, (_, i) =>
        `<url><loc>https://www.buffalowildwings.com/locations/us/nj/city-${i}/${100 + i}-main-street/store-${1000 + i}/</loc></url>`).join('') + '</urlset>';
    mockFetch(router([
        ['GET', SITEMAP_URL, { status: 200, body: xml }],
        ['GET', '/rest/v1/bww_scan_stores', { status: 200, body: [] }],
        ['POST', '/rest/v1/bww_scan_stores', { status: 201, body: [] }],
        ['POST', '/rest/v1/bww_scan_runs', { status: 201, body: [] }],
    ]));
    const res = await handler();
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).baseline, true);
});

test('the weekly function returns 500 (and does not throw) when the scan fails', async () => {
    mockFetch(router([['GET', SITEMAP_URL, { status: 503, body: 'down' }]]));
    const res = await handler();
    assert.equal(res.statusCode, 500);
});

test('netlify.toml schedules the scan weekly', () => {
    const toml = fs.readFileSync(path.join(__dirname, '..', 'netlify.toml'), 'utf8');
    assert.match(toml, /\[functions\."bww-scan"\]\s*[\r\n]+\s*schedule\s*=\s*"@weekly"/);
});
