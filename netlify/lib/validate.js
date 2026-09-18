const { HttpError } = require('./http');

const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCATION_TYPES = ['mp', 'bww_pa', 'bww_nj', 'dunkin'];

const cleanUsername = (v) => String(v == null ? '' : v).trim().toLowerCase();
const toEmail = (username) => `${username}@pcg-map.local`;

function assertUsername(v) {
    const username = cleanUsername(v);
    if (!USERNAME_RE.test(username)) {
        throw new HttpError(400, 'bad_username', 'Username must be 3-32 characters: letters, numbers, dot, dash or underscore.');
    }
    return username;
}

function assertPassword(v) {
    if (typeof v !== 'string' || v.length < 8 || v.length > 72) {
        throw new HttpError(400, 'bad_password', 'Password must be 8-72 characters.');
    }
    return v;
}

function assertRole(v) {
    if (v !== 'admin' && v !== 'user') throw new HttpError(400, 'bad_role', 'Role must be admin or user.');
    return v;
}

function assertUuid(v) {
    if (typeof v !== 'string' || !UUID_RE.test(v)) throw new HttpError(400, 'bad_id', 'Invalid id.');
    return v;
}

const str = (min, max) => (v) => {
    const s = String(v).trim();
    if (s.length < min || s.length > max) throw new Error('length');
    return s;
};
const num = (min, max) => (v) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new Error('range');
    return n;
};
const bool = (v) => {
    if (v === true || v === 'true') return true;
    if (v === false || v === 'false') return false;
    throw new Error('bool');
};

const FIELDS = {
    external_id: { label: 'ID', parse: str(1, 40) },
    name: { label: 'Name', parse: str(1, 200) },
    address: { label: 'Address', parse: str(1, 300) },
    property_name: { label: 'Property name', parse: str(1, 200) },
    region: { label: 'Region', parse: str(1, 100) },
    lat: { label: 'Latitude', parse: num(-90, 90) },
    lng: { label: 'Longitude', parse: num(-180, 180) },
    radius_miles: { label: 'Radius', parse: num(0.01, 50) },
    combo: { label: 'Combo', parse: bool },
    active: { label: 'Active', parse: bool },
};

const REQUIRED = {
    mp: ['external_id', 'lat', 'lng', 'radius_miles'],
    bww_pa: ['name', 'address', 'lat', 'lng'],
    bww_nj: ['name', 'address', 'lat', 'lng'],
    dunkin: ['external_id', 'address', 'region', 'lat', 'lng'],
};
const OPTIONAL = {
    mp: ['active'],
    bww_pa: ['active'],
    bww_nj: ['active'],
    dunkin: ['property_name', 'combo', 'active'],
};

function cleanLocation(type, input, { partial = false } = {}) {
    if (!LOCATION_TYPES.includes(type)) throw new HttpError(400, 'bad_type', 'Unknown location type.');
    const allowed = [...REQUIRED[type], ...OPTIONAL[type]];
    const out = {};
    for (const name of allowed) {
        const value = input[name];
        const present = value !== undefined && value !== null && value !== '';
        if (!present) {
            if (name === 'property_name' && value === '') out[name] = null;
            else if (!partial && REQUIRED[type].includes(name)) {
                throw new HttpError(400, 'bad_field', `${FIELDS[name].label} is required.`);
            }
            continue;
        }
        try {
            out[name] = FIELDS[name].parse(value);
        } catch {
            throw new HttpError(400, 'bad_field', `${FIELDS[name].label} is not valid.`);
        }
    }
    return out;
}

module.exports = {
    USERNAME_RE, LOCATION_TYPES, cleanUsername, toEmail,
    assertUsername, assertPassword, assertRole, assertUuid, cleanLocation,
};
