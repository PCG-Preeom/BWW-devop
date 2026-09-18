const { HttpError, json, wrap } = require('../lib/http');
const { requireSession } = require('../lib/auth');
const { rest } = require('../lib/supabase');

function shapeLocations(rows) {
    return {
        mp: rows
            .filter(r => r.type === 'mp')
            .map(r => ({ id: r.external_id, lat: r.lat, lng: r.lng, radiusMiles: r.radius_miles })),
        bwwPa: rows
            .filter(r => r.type === 'bww_pa')
            .map(r => ({ name: r.name, address: r.address, lat: r.lat, lng: r.lng })),
        bwwNj: rows
            .filter(r => r.type === 'bww_nj')
            .map(r => ({ name: r.name, address: r.address, lat: r.lat, lng: r.lng })),
        dunkin: rows
            .filter(r => r.type === 'dunkin')
            .map(r => ({
                id: r.external_id,
                address: r.address,
                ...(r.property_name ? { propertyName: r.property_name } : {}),
                region: r.region,
                lat: r.lat,
                lng: r.lng,
                ...(r.combo ? { combo: true } : {}),
            })),
    };
}

exports.shapeLocations = shapeLocations;

exports.handler = wrap(async (event) => {
    let session;
    try {
        session = await requireSession(event);
    } catch (err) {
        if (err instanceof HttpError) throw err;
        throw new HttpError(500, 'debug_session_error', `DEBUG requireSession: ${err.message}`);
    }
    void session;

    const res = await rest('/locations?active=eq.true&order=external_id.asc&limit=1000');
    if (!res.ok) throw new HttpError(500, 'debug_supabase_error', `DEBUG Supabase ${res.status}: ${JSON.stringify(res.data)}`);

    return json(200, shapeLocations(res.data));
});
