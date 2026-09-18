const { HttpError, json, parseBody, wrap } = require('../lib/http');
const { requireAdmin } = require('../lib/auth');
const { rest } = require('../lib/supabase');
const { cleanLocation, LOCATION_TYPES } = require('../lib/validate');

function assertRowId(v) {
    const n = Number(v);
    if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'bad_id', 'Invalid id.');
    return n;
}

async function list(event) {
    const type = (event.queryStringParameters || {}).type;
    let path = '/locations?select=*&order=type.asc,external_id.asc,name.asc&limit=2000';
    if (type !== undefined && type !== '') {
        if (!LOCATION_TYPES.includes(type)) throw new HttpError(400, 'bad_type', 'Unknown location type.');
        path += `&type=eq.${type}`;
    }
    const r = await rest(path);
    if (!r.ok) throw new Error(`Location list failed: ${r.status}`);
    return json(200, { locations: r.data });
}

async function create(event) {
    const body = parseBody(event);
    const fields = cleanLocation(body.type, body);
    const r = await rest('/locations', {
        method: 'POST',
        prefer: 'return=representation',
        body: { type: body.type, ...fields },
    });
    if (!r.ok || !Array.isArray(r.data) || !r.data[0]) throw new Error(`Location insert failed: ${r.status}`);
    return json(201, { location: r.data[0] });
}

async function update(event) {
    const body = parseBody(event);
    const id = assertRowId(body.id);
    const existing = await rest(`/locations?id=eq.${id}&select=id,type&limit=1`);
    if (!existing.ok) throw new Error(`Location lookup failed: ${existing.status}`);
    const row = Array.isArray(existing.data) ? existing.data[0] : null;
    if (!row) throw new HttpError(404, 'not_found', 'Location not found.');

    const fields = cleanLocation(row.type, body, { partial: true });
    if (!Object.keys(fields).length) throw new HttpError(400, 'nothing_to_update', 'Nothing to change.');

    const r = await rest(`/locations?id=eq.${id}`, { method: 'PATCH', prefer: 'return=representation', body: fields });
    if (!r.ok || !Array.isArray(r.data) || !r.data[0]) throw new Error(`Location update failed: ${r.status}`);
    return json(200, { location: r.data[0] });
}

async function remove(event) {
    const id = assertRowId((event.queryStringParameters || {}).id);
    const r = await rest(`/locations?id=eq.${id}`, { method: 'DELETE' });
    if (!r.ok) throw new Error(`Location delete failed: ${r.status}`);
    return json(200, { ok: true });
}

exports.handler = wrap(async (event) => {
    await requireAdmin(event);
    switch (event.httpMethod) {
        case 'GET': return list(event);
        case 'POST': return create(event);
        case 'PATCH': return update(event);
        case 'DELETE': return remove(event);
        default: throw new HttpError(405, 'method_not_allowed', 'Method not allowed.');
    }
});
