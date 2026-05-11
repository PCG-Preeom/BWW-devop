exports.handler = async () => {
    try {
        const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
        const supabaseKey = process.env.SUPABASE_ANON_KEY;

        const res = await fetch(
            `${supabaseUrl}/rest/v1/locations?active=eq.true&order=external_id.asc&limit=1000`,
            {
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                },
            }
        );

        if (!res.ok) throw new Error(`Supabase error: ${res.status}`);

        const rows = await res.json();

        const data = {
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

        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        };
    } catch (err) {
        console.error('Locations fetch error:', err);
        return { statusCode: 500, body: 'Failed to load location data' };
    }
};
