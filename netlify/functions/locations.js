const { json, wrap } = require('../lib/http');
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
    await requireSession(event);

    const res = await rest('/locations?active=eq.true&order=external_id.asc&limit=1000');
    if (!res.ok) throw new Error(`Supabase error: ${res.status}`);

    return json(200, shapeLocations(res.data));
});
