const { rest } = require('./supabase');

const SITEMAP_URL = 'https://www.buffalowildwings.com/locations.xml';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const MIN_STORES = 30; // PA + NJ currently list ~75; far fewer means the sitemap format changed
const USER_AGENT = 'PCGMap-BWWScan/1.0 (weekly new-store check for an internal map)';
const UPPER_WORDS = new Set(['us', 'nj', 'pa', 'ne', 'nw', 'se', 'sw']);

// Rough bounding box around Pennsylvania and New Jersey; a geocoder hit outside it is a miss.
const SERVICE_AREA = { minLat: 38.9, maxLat: 42.6, minLng: -80.6, maxLng: -73.8 };

function inServiceArea(lat, lng) {
    return lat >= SERVICE_AREA.minLat && lat <= SERVICE_AREA.maxLat && lng >= SERVICE_AREA.minLng && lng <= SERVICE_AREA.maxLng;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function titleCase(text) {
    return text
        .split(' ')
        .map((w) => {
            const bare = w.replace(/[^a-z]/gi, '').toLowerCase();
            if (UPPER_WORDS.has(bare)) return w.toUpperCase();
            return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
        })
        .join(' ');
}

function prettyAddress(slug) {
    return titleCase(slug.replace(/,-/g, ', ').replace(/-/g, ' ').trim());
}

function prettyCity(slug) {
    return titleCase(slug.replace(/-(nj|pa)$/i, '').replace(/-/g, ' ').trim());
}

function parseSitemap(xml) {
    const stores = [];
    const re = /<loc>\s*(https:\/\/www\.buffalowildwings\.com\/locations\/us\/(pa|nj)\/([^/<]+)\/([^/<]+)\/store-(\d+)\/?)\s*<\/loc>/g;
    let m;
    while ((m = re.exec(xml))) {
        stores.push({
            storeId: m[5],
            state: m[2],
            city: prettyCity(m[3]),
            address: prettyAddress(m[4]),
            url: m[1],
        });
    }
    return stores;
}

async function geocode(address, city, state) {
    const street = address.replace(/,?\s*(suite|ste|unit|#).*$/i, '').trim();
    const params = new URLSearchParams({
        format: 'json', limit: '1', countrycodes: 'us', street, city, state: state.toUpperCase(),
    });
    try {
        const res = await fetch(`${NOMINATIM_URL}?${params}`, {
            headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        });
        if (!res.ok) return null;
        const rows = JSON.parse(await res.text());
        if (!Array.isArray(rows) || !rows[0]) return null;
        const lat = Number(rows[0].lat);
        const lng = Number(rows[0].lon);
        return Number.isFinite(lat) && Number.isFinite(lng) && inServiceArea(lat, lng) ? { lat, lng } : null;
    } catch {
        return null;
    }
}

async function recordRun(total, newCount, note) {
    await rest('/bww_scan_runs', { method: 'POST', body: { total, new_count: newCount, note } });
}

// Reads BWW's public sitemap and queues stores we have not seen before.
// First run (empty table) records a baseline and flags nothing.
async function runScan({ maxGeocode = 15, sleepMs = 1100 } = {}) {
    const res = await fetch(SITEMAP_URL, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) throw new Error(`Could not download the BWW sitemap (status ${res.status}).`);
    const stores = parseSitemap(await res.text());
    if (stores.length < MIN_STORES) {
        throw new Error(`Unexpected sitemap: only ${stores.length} PA/NJ stores found (expected ${MIN_STORES}+). Nothing was saved.`);
    }

    const existingRes = await rest('/bww_scan_stores?select=store_id,status,lat,lng&limit=5000');
    if (!existingRes.ok) throw new Error(`Could not read scan table (status ${existingRes.status}). Did you run supabase-bww-scan.sql?`);
    const existing = existingRes.data || [];

    const toRow = (s, extra) => ({
        store_id: s.storeId, state: s.state, city: s.city, address: s.address, source_url: s.url, ...extra,
    });

    if (existing.length === 0) {
        const ins = await rest('/bww_scan_stores', {
            method: 'POST',
            prefer: 'resolution=ignore-duplicates',
            body: stores.map((s) => toRow(s, { status: 'baseline' })),
        });
        if (!ins.ok) throw new Error(`Baseline save failed (status ${ins.status}).`);
        await recordRun(stores.length, 0, 'baseline');
        return { baseline: true, total: stores.length, newCount: 0, geocoded: 0 };
    }

    const seen = new Set(existing.map((r) => r.store_id));
    const fresh = stores.filter((s) => !seen.has(s.storeId));
    let budget = maxGeocode;
    let geocoded = 0;

    const rows = [];
    for (const s of fresh) {
        let coords = null;
        if (budget > 0) {
            coords = await geocode(s.address, s.city, s.state);
            budget -= 1;
            if (coords) geocoded += 1;
            if (sleepMs) await sleep(sleepMs);
        }
        rows.push(toRow(s, { lat: coords ? coords.lat : null, lng: coords ? coords.lng : null, status: 'pending' }));
    }
    if (rows.length) {
        const ins = await rest('/bww_scan_stores', { method: 'POST', prefer: 'resolution=ignore-duplicates', body: rows });
        if (!ins.ok) throw new Error(`Saving new stores failed (status ${ins.status}).`);
    }

    // Retry geocoding for earlier pending stores that still have no coordinates.
    const byId = new Map(stores.map((s) => [s.storeId, s]));
    for (const r of existing.filter((e) => e.status === 'pending' && (e.lat == null || e.lng == null))) {
        const s = byId.get(r.store_id);
        if (!s || budget <= 0) continue;
        const coords = await geocode(s.address, s.city, s.state);
        budget -= 1;
        if (sleepMs) await sleep(sleepMs);
        if (!coords) continue;
        const patch = await rest(`/bww_scan_stores?store_id=eq.${encodeURIComponent(r.store_id)}`, { method: 'PATCH', body: coords });
        if (patch.ok) geocoded += 1;
    }

    await recordRun(stores.length, fresh.length, null);
    return { baseline: false, total: stores.length, newCount: fresh.length, geocoded };
}

module.exports = { SITEMAP_URL, inServiceArea, parseSitemap, prettyAddress, prettyCity, geocode, runScan };
