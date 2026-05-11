exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let token;
    try {
        ({ token } = JSON.parse(event.body || '{}'));
    } catch {
        return { statusCode: 400, body: JSON.stringify({ success: false }) };
    }

    if (!token) {
        return { statusCode: 400, body: JSON.stringify({ success: false }) };
    }

    try {
        const supabaseUrl = process.env.SUPABASE_DATABASE_URL;
        const supabaseKey = process.env.SUPABASE_ANON_KEY;

        const res = await fetch(
            `${supabaseUrl}/rest/v1/access_tokens?token=eq.${encodeURIComponent(token)}&active=eq.true&select=id&limit=1`,
            {
                headers: {
                    apikey: supabaseKey,
                    Authorization: `Bearer ${supabaseKey}`,
                },
            }
        );

        if (!res.ok) throw new Error(`Supabase error: ${res.status}`);

        const rows = await res.json();
        return {
            statusCode: 200,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: rows.length > 0 }),
        };
    } catch (err) {
        console.error('Token verification error:', err);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ success: false }),
        };
    }
};
