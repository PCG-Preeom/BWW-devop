const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { requireAdmin } = require('../lib/auth');
const { rest } = require('../lib/supabase');
const { cleanLocation } = require('../lib/validate');
const { runScan } = require('../lib/bwwscan');

const COLUMNS = 'id,store_id,state,city,address,source_url,lat,lng,status,first_seen';

async function overview() {
    const pending = await rest(`/bww_scan_stores?status=eq.pending&select=${COLUMNS}&order=state.asc,city.asc`);
    if (!pending.ok) {
        throw new Error(`Pending list failed (status ${pending.status}). Did you run supabase-bww-scan.sql?`);
    }
    const runs = await rest('/bww_scan_runs?select=ran_at,total,new_count,note&order=ran_at.desc&limit=1');
    const lastRun = runs.ok && Array.isArray(runs.data) && runs.data[0] ? runs.data[0] : null;
    return json(200, { pending: pending.data, lastRun });
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

async function approve(body) {
    const row = await loadRow(body.id);
    const hasTyped = body.lat !== undefined && body.lat !== '' && body.lng !== undefined && body.lng !== '';
    const lat = hasTyped ? body.lat : row.lat;
    const lng = hasTyped ? body.lng : row.lng;
    if (lat == null || lng == null) {
        throw new HttpError(400, 'needs_coordinates', 'Enter a latitude and longitude before approving.');
    }

    const type = row.state === 'nj' ? 'bww_nj' : 'bww_pa';
    const fields = cleanLocation(type, {
        name: body.name || `Buffalo Wild Wings - ${row.city}`,
        address: body.address || `${row.address}, ${row.city}, ${row.state.toUpperCase()}`,
        lat,
        lng,
    });

    const created = await rest('/locations', { method: 'POST', prefer: 'return=representation', body: { type, ...fields } });
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

exports.handler = wrap(async (event) => {
    await requireAdmin(event);

    if (event.httpMethod === 'GET') return overview();
    if (event.httpMethod !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');

    const body = parseBody(event);
    switch (body.action) {
        case 'scan': {
            try {
                return json(200, { result: await runScan() });
            } catch (err) {
                console.error(err);
                throw new HttpError(502, 'scan_failed', err.message);
            }
        }
        case 'approve': return approve(body);
        case 'reject': return reject(body);
        default: throw new HttpError(400, 'bad_action', 'Unknown action.');
    }
});
