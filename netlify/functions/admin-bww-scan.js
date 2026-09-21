const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { requireAdmin } = require('../lib/auth');
const { rest } = require('../lib/supabase');
const { cleanLocation } = require('../lib/validate');
const { runScan, inServiceArea } = require('../lib/bwwscan');

const COLUMNS = 'id,store_id,state,city,address,source_url,lat,lng,status,first_seen';
const DUPLICATE_MILES = 0.1; // a new store this close to an existing BWW pin is treated as the same store
const ADMIN_SCAN_GEOCODE_LIMIT = 5; // keeps a button-triggered scan under Netlify's 10 second limit

function miles(a, b) {
    const R = 3958.8;
    const rad = (d) => (d * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}

const streetNumber = (address) => {
    const m = /^\s*(\d+)/.exec(address || '');
    return m ? m[1] : null;
};

async function overview() {
    const pending = await rest(`/bww_scan_stores?status=eq.pending&select=${COLUMNS}&order=state.asc,city.asc`);
    if (!pending.ok) {
        throw new Error(`Pending list failed (status ${pending.status}). Did you run supabase-bww-scan.sql?`);
    }
    const runs = await rest('/bww_scan_runs?select=ran_at,total,new_count,note&order=ran_at.desc&limit=1');
    const lastRun = runs.ok && Array.isArray(runs.data) && runs.data[0] ? runs.data[0] : null;
    const baseline = await rest('/bww_scan_stores?status=eq.baseline&select=id&limit=5000');
    const baselineCount = baseline.ok && Array.isArray(baseline.data) ? baseline.data.length : 0;
    return json(200, { pending: pending.data, lastRun, baselineCount });
}

async function loadRow(id) {
    const n = Number(id);
    if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'bad_id', 'Invalid id.');
    const r = await rest(`/bww_scan_stores?id=eq.${n}&select=${COLUMNS}&limit=1`);
    if (!r.ok) throw new Error(`Store lookup failed (status ${r.status}).`);
    const row = Array.isArray(r.data) ? r.data[0] : null;
    if (!row) throw new HttpError(404, 'not_found', 'That store was not found.');
    if (row.status !== 'pending') throw new HttpError(409, 'not_pending', 'That store was already reviewed.');
    return row;
}

async function existingBwwLocations() {
    const r = await rest('/locations?type=in.(bww_pa,bww_nj)&select=type,address,lat,lng&limit=5000');
    if (!r.ok) throw new Error(`Could not read existing locations (status ${r.status}).`);
    return Array.isArray(r.data) ? r.data : [];
}

const locationFields = (row, overrides = {}) => {
    const type = row.state === 'nj' ? 'bww_nj' : 'bww_pa';
    return {
        type,
        ...cleanLocation(type, {
            name: overrides.name || `Buffalo Wild Wings - ${row.city}`,
            address: overrides.address || `${row.address}, ${row.city}, ${row.state.toUpperCase()}`,
            lat: overrides.lat,
            lng: overrides.lng,
        }),
    };
};

async function approve(body) {
    const row = await loadRow(body.id);
    const hasTyped = body.lat !== undefined && body.lat !== '' && body.lng !== undefined && body.lng !== '';
    const lat = hasTyped ? body.lat : row.lat;
    const lng = hasTyped ? body.lng : row.lng;
    if (lat == null || lng == null) {
        throw new HttpError(400, 'needs_coordinates', 'Enter a latitude and longitude before approving.');
    }

    const fields = locationFields(row, { name: body.name, address: body.address, lat, lng });
    const created = await rest('/locations', { method: 'POST', prefer: 'return=representation', body: fields });
    if (!created.ok) throw new Error(`Adding the location failed (status ${created.status}).`);

    const marked = await rest(`/bww_scan_stores?id=eq.${row.id}`, {
        method: 'PATCH',
        body: { status: 'approved', lat: fields.lat, lng: fields.lng, reviewed_at: new Date().toISOString() },
    });
    if (!marked.ok) throw new Error(`Marking the store approved failed (status ${marked.status}).`);
    return json(200, { ok: true });
}

async function reject(body) {
    const row = await loadRow(body.id);
    const r = await rest(`/bww_scan_stores?id=eq.${row.id}`, {
        method: 'PATCH',
        body: { status: 'rejected', reviewed_at: new Date().toISOString() },
    });
    if (!r.ok) throw new Error(`Rejecting the store failed (status ${r.status}).`);
    return json(200, { ok: true });
}

// Moves the stores recorded as "baseline" into the pending list, except ones already pinned on the map.
async function importBaseline() {
    const existing = await existingBwwLocations();
    const known = new Set(
        existing
            .map((l) => `${l.type === 'bww_nj' ? 'nj' : 'pa'}:${streetNumber(l.address)}`)
            .filter((key) => !key.endsWith(':null')),
    );

    const r = await rest('/bww_scan_stores?status=eq.baseline&select=id,state,address&limit=5000');
    if (!r.ok) throw new Error(`Could not read the baseline (status ${r.status}).`);
    const rows = Array.isArray(r.data) ? r.data : [];

    const toImport = rows.filter((row) => !known.has(`${row.state}:${streetNumber(row.address)}`));
    if (toImport.length) {
        const ids = toImport.map((row) => row.id).join(',');
        const patch = await rest(`/bww_scan_stores?id=in.(${ids})`, { method: 'PATCH', body: { status: 'pending' } });
        if (!patch.ok) throw new Error(`Importing the stores failed (status ${patch.status}).`);
    }
    return json(200, { imported: toImport.length, skipped: rows.length - toImport.length });
}

async function setCoords(body) {
    const row = await loadRow(body.id);
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || !inServiceArea(lat, lng)) {
        throw new HttpError(400, 'bad_coordinates', 'Those coordinates are not in Pennsylvania or New Jersey.');
    }
    const r = await rest(`/bww_scan_stores?id=eq.${row.id}`, { method: 'PATCH', body: { lat, lng } });
    if (!r.ok) throw new Error(`Saving coordinates failed (status ${r.status}).`);
    return json(200, { ok: true });
}

// Adds every pending store that has coordinates. A store within DUPLICATE_MILES of an
// existing BWW pin (or of one added in this same batch) is marked rejected instead.
async function approveAll() {
    const existing = await existingBwwLocations();
    const r = await rest(`/bww_scan_stores?status=eq.pending&lat=not.is.null&lng=not.is.null&select=${COLUMNS}&order=state.asc,city.asc`);
    if (!r.ok) throw new Error(`Could not read pending stores (status ${r.status}).`);
    const ready = (Array.isArray(r.data) ? r.data : []).filter((row) => row.lat != null && row.lng != null);

    const pins = existing.filter((l) => l.lat != null && l.lng != null).map((l) => ({ lat: l.lat, lng: l.lng }));
    const toAdd = [];
    const duplicates = [];
    for (const row of ready) {
        const point = { lat: row.lat, lng: row.lng };
        if (pins.some((pin) => miles(pin, point) <= DUPLICATE_MILES)) {
            duplicates.push(row);
        } else {
            toAdd.push({ row, fields: locationFields(row, { lat: row.lat, lng: row.lng }) });
            pins.push(point);
        }
    }

    const stamp = new Date().toISOString();
    if (toAdd.length) {
        const created = await rest('/locations', { method: 'POST', prefer: 'return=representation', body: toAdd.map((x) => x.fields) });
        if (!created.ok) throw new Error(`Adding the locations failed (status ${created.status}).`);
        const ids = toAdd.map((x) => x.row.id).join(',');
        const marked = await rest(`/bww_scan_stores?id=in.(${ids})`, { method: 'PATCH', body: { status: 'approved', reviewed_at: stamp } });
        if (!marked.ok) throw new Error(`Marking stores approved failed (status ${marked.status}).`);
    }
    if (duplicates.length) {
        const ids = duplicates.map((row) => row.id).join(',');
        const marked = await rest(`/bww_scan_stores?id=in.(${ids})`, { method: 'PATCH', body: { status: 'rejected', reviewed_at: stamp } });
        if (!marked.ok) throw new Error(`Marking duplicates failed (status ${marked.status}).`);
    }
    return json(200, { approved: toAdd.length, duplicates: duplicates.length });
}

exports.handler = wrap(async (event) => {
    await requireAdmin(event);

    if (event.httpMethod === 'GET') return overview();
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');

    const body = parseBody(event);
    switch (body.action) {
        case 'scan': {
            try {
                return json(200, { result: await runScan({ maxGeocode: ADMIN_SCAN_GEOCODE_LIMIT }) });
            } catch (err) {
                console.error(err);
                throw new HttpError(502, 'scan_failed', err.message);
            }
        }
        case 'approve': return approve(body);
        case 'reject': return reject(body);
        case 'import_baseline': return importBaseline();
        case 'set_coords': return setCoords(body);
        case 'approve_all': return approveAll();
        default: throw new HttpError(400, 'bad_action', 'Unknown action.');
    }
});
