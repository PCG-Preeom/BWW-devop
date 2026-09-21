// Location data is loaded from the static data file after local access unlock.
let MP = [];
let BWW_PA = [];
let BWW_NJ = [];
let DUNKIN = [];
let ALL = [];
let ALL_MP = [];
let ALL_BWW = [];
let ALL_DUNKIN = [];
let ALL_DESTINATIONS = [];

const REMEMBERED_USERNAME_KEY = 'pcgRememberedUsername';
const INACTIVITY_LIMIT_MS = 5 * 60 * 1000;
let appInitialized = false;
let currentSession = null;
let inactivityTimer = null;

function getSession() {
    return currentSession;
}

function setSession(session) {
    currentSession = session || null;
}

function resetInactivityTimer() {
    clearTimeout(inactivityTimer);
    if (!appInitialized) return;
    inactivityTimer = setTimeout(lockApp, INACTIVITY_LIMIT_MS);
}

function lockApp(reason) {
    if (!appInitialized) return;
    appInitialized = false;
    clearTimeout(inactivityTimer);
    setSession(null);
    closeAdminPanel();
    const adminToggle = document.getElementById('adminToggle');
    if (adminToggle) adminToggle.hidden = true;

    document.body.classList.add('auth-locked');
    const input = document.getElementById('accessToken');
    const message = document.getElementById('accessMessage');
    if (input) input.value = '';
    if (message) message.textContent = reason || '';
    document.getElementById('accessUsername')?.focus();
}

['mousemove', 'keydown', 'mousedown', 'scroll', 'touchstart'].forEach((type) => {
    document.addEventListener(type, resetInactivityTimer, { passive: true });
});

const BRAND_FILTERS = {
    MP: true,
    BWW: true,
    Dunkin: true
};
let locationSearchType = 'MP';

function normalizeLocationData(data) {
    const normalizeGroup = (items = []) => items
        .map(item => ({ ...item, lat: Number(item.lat), lng: Number(item.lng) }))
        .filter(item => Number.isFinite(item.lat) && Number.isFinite(item.lng));

    MP = normalizeGroup(data.mp);
    BWW_PA = normalizeGroup(data.bwwPa);
    BWW_NJ = normalizeGroup(data.bwwNj);
    DUNKIN = normalizeGroup(data.dunkin);

    ALL = [
        ...MP.map(x => ({ ...x, type: 'MP', color: '#1e3a8a' })),
        ...BWW_PA.map(x => ({ ...x, type: 'BWW PA', color: '#dc2626' })),
        ...BWW_NJ.map(x => ({ ...x, type: 'BWW NJ', color: '#c2410c' })),
        ...DUNKIN.map(x => ({
            ...x,
            name: `${x.combo ? 'Dunkin / Baskin-Robbins' : 'Dunkin'} #${x.id}${x.propertyName ? ` (${x.propertyName})` : ''}`,
            type: x.combo ? 'Dunkin / Baskin-Robbins' : 'Dunkin',
            color: x.combo ? '#db2777' : '#f97316'
        }))
    ];

    ALL_MP = ALL.filter(p => p.type === 'MP');
    ALL_BWW = ALL.filter(p => p.type.startsWith('BWW'));
    ALL_DUNKIN = ALL.filter(p => p.type.startsWith('Dunkin'));
    ALL_DESTINATIONS = ALL.filter(p => p.type !== 'MP');
}

async function loadLocationData() {
    const res = await authFetch('/.netlify/functions/locations');
    if (!res.ok) {
        const body = await res.text().catch(() => '');
        console.error(`Location fetch failed (${res.status}):`, body);
        throw new Error('Unable to load location data.');
    }
    normalizeLocationData(await res.json());
    return true;
}

function unlockMap() {
    if (appInitialized) return;
    appInitialized = true;

    const submitBtn = document.querySelector('#accessForm button[type="submit"]');
    const rect = submitBtn
        ? submitBtn.getBoundingClientRect()
        : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0 };
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);

    // Spawn particles only — no ripple overlay during unlock
    const colors = ['#d4af37', '#FFD700', '#f8d675', '#e7c765', '#ffffff'];
    for (let i = 0; i < 18; i++) {
        const p = document.createElement('div');
        p.className = 'theme-particle';
        const angle = (i / 18) * Math.PI * 2;
        const dist = 60 + Math.random() * 100;
        p.style.left = (cx - 3) + 'px';
        p.style.top  = (cy - 3) + 'px';
        p.style.setProperty('--px', Math.cos(angle) * dist + 'px');
        p.style.setProperty('--py', Math.sin(angle) * dist + 'px');
        p.style.background = colors[i % colors.length];
        const size = (4 + Math.random() * 6) + 'px';
        p.style.width  = size;
        p.style.height = size;
        p.style.animationDelay = (Math.random() * 0.1) + 's';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 800);
    }

    document.body.classList.add('access-exiting');

    setTimeout(() => {
        document.body.classList.remove('auth-locked', 'access-exiting');
        initializeApp();
        setTimeout(() => map.invalidateSize(), 250);
        resetInactivityTimer();
    }, 500);
}

function logAccessAttempt(success) {
    fetch('/api/access-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            success,
            path: window.location.pathname,
            userAgent: navigator.userAgent
        })
    }).catch(() => {
        // Logging only works when the map is served through server.js.
    });
}

async function forcePasswordChange(session) {
    const message = document.getElementById('accessMessage');
    while (true) {
        const next = window.prompt('This account needs a new password (min 8 characters). Set one now:');
        if (next === null) continue; // must set a password to continue
        if (next.length < 8) {
            if (message) message.textContent = 'Password must be at least 8 characters.';
            continue;
        }
        const res = await fetch('/.netlify/functions/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
            body: JSON.stringify({ new_password: next }),
        }).catch(() => null);
        if (res?.ok) {
            setSession({ ...session, must_change_password: false });
            return;
        }
        if (message) message.textContent = 'Could not set password, try again.';
    }
}

async function authFetch(path, options = {}) {
    const doFetch = () => fetch(path, {
        ...options,
        headers: { ...(options.headers || {}), Authorization: `Bearer ${getSession()?.access_token}` },
    });
    let res = await doFetch();
    if (res.status === 401 && getSession()?.refresh_token) {
        const r = await fetch('/.netlify/functions/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refresh_token: getSession().refresh_token }),
        }).catch(() => null);
        if (r?.ok) {
            setSession({ ...getSession(), ...(await r.json()) });
            res = await doFetch();
        }
    }
    return res;
}

function renderAdminUserRow(user) {
    const tr = document.createElement('tr');

    const usernameTd = document.createElement('td');
    usernameTd.textContent = user.username;
    tr.append(usernameTd);

    const roleTd = document.createElement('td');
    roleTd.textContent = user.role;
    tr.append(roleTd);

    const statusTd = document.createElement('td');
    statusTd.textContent = user.active ? 'Active' : 'Disabled';
    statusTd.className = user.active ? 'admin-status-active' : 'admin-status-disabled';
    tr.append(statusTd);

    const actionsTd = document.createElement('td');
    const isSelf = user.username === getSession()?.username;

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = user.active ? 'Disable' : 'Enable';
    toggleBtn.disabled = isSelf && user.active;
    toggleBtn.addEventListener('click', () => setUserActive(user.id, !user.active));
    actionsTd.append(toggleBtn);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Reset password';
    resetBtn.addEventListener('click', () => resetUserPassword(user.id));
    actionsTd.append(resetBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'danger';
    deleteBtn.disabled = isSelf;
    deleteBtn.addEventListener('click', () => deleteUserAccount(user.id, user.username));
    actionsTd.append(deleteBtn);

    tr.append(actionsTd);
    return tr;
}

async function loadAdminUsers() {
    const body = document.getElementById('adminUsersBody');
    if (!body) return;
    body.textContent = '';

    const res = await authFetch('/.netlify/functions/admin-users').catch(() => null);
    if (!res?.ok) return;
    const { users } = await res.json();
    users.forEach((user) => body.append(renderAdminUserRow(user)));
}

async function setUserActive(id, active) {
    await authFetch('/.netlify/functions/admin-users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active }),
    }).catch(() => null);
    loadAdminUsers();
}

async function resetUserPassword(id) {
    const next = window.prompt('New temporary password (min 8 characters):');
    if (!next) return;
    if (next.length < 8) {
        window.alert('Password must be at least 8 characters.');
        return;
    }
    await authFetch('/.netlify/functions/admin-users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, temp_password: next }),
    }).catch(() => null);
    loadAdminUsers();
}

async function deleteUserAccount(id, username) {
    if (!window.confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    await authFetch(`/.netlify/functions/admin-users?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    loadAdminUsers();
}

const LOCATION_FIELD_DEFS = {
    mp: [
        { name: 'external_id', label: 'ID', type: 'text' },
        { name: 'lat', label: 'Latitude', type: 'number' },
        { name: 'lng', label: 'Longitude', type: 'number' },
        { name: 'radius_miles', label: 'Radius (mi)', type: 'number' },
    ],
    bww_pa: [
        { name: 'name', label: 'Name', type: 'text' },
        { name: 'address', label: 'Address', type: 'text' },
        { name: 'lat', label: 'Latitude', type: 'number' },
        { name: 'lng', label: 'Longitude', type: 'number' },
    ],
    bww_nj: [
        { name: 'name', label: 'Name', type: 'text' },
        { name: 'address', label: 'Address', type: 'text' },
        { name: 'lat', label: 'Latitude', type: 'number' },
        { name: 'lng', label: 'Longitude', type: 'number' },
    ],
    dunkin: [
        { name: 'external_id', label: 'ID', type: 'text' },
        { name: 'address', label: 'Address', type: 'text' },
        { name: 'region', label: 'Region', type: 'text' },
        { name: 'lat', label: 'Latitude', type: 'number' },
        { name: 'lng', label: 'Longitude', type: 'number' },
        { name: 'property_name', label: 'Property name (optional)', type: 'text' },
        { name: 'combo', label: 'Combo (Dunkin/Baskin-Robbins)', type: 'checkbox' },
    ],
};

function locationRowLabel(loc) {
    if (loc.type === 'mp') return `MP ${loc.external_id}`;
    if (loc.type === 'dunkin') return `Dunkin #${loc.external_id}${loc.property_name ? ` (${loc.property_name})` : ''}`;
    return loc.name || loc.address || `#${loc.id}`;
}

function renderLocationFields(type, values = {}) {
    const container = document.getElementById('adminLocFields');
    container.textContent = '';
    (LOCATION_FIELD_DEFS[type] || []).forEach((f) => {
        if (f.type === 'checkbox') {
            const label = document.createElement('label');
            label.className = 'admin-loc-checkbox';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.name = f.name;
            input.checked = Boolean(values[f.name]);
            label.append(input, document.createTextNode(f.label));
            container.append(label);
        } else {
            const input = document.createElement('input');
            input.type = f.type;
            input.name = f.name;
            input.placeholder = f.label;
            if (f.type === 'number') input.step = 'any';
            if (values[f.name] !== undefined && values[f.name] !== null) input.value = values[f.name];
            container.append(input);
        }
    });
}

function collectLocationFields(type) {
    const out = {};
    (LOCATION_FIELD_DEFS[type] || []).forEach((f) => {
        const el = document.querySelector(`#adminLocFields [name="${f.name}"]`);
        if (!el) return;
        out[f.name] = f.type === 'checkbox' ? el.checked : el.value;
    });
    return out;
}

function renderAdminLocationRow(loc) {
    const tr = document.createElement('tr');

    const labelTd = document.createElement('td');
    labelTd.textContent = locationRowLabel(loc);
    tr.append(labelTd);

    const statusTd = document.createElement('td');
    statusTd.textContent = loc.active ? 'Active' : 'Inactive';
    statusTd.className = loc.active ? 'admin-status-active' : 'admin-status-disabled';
    tr.append(statusTd);

    const actionsTd = document.createElement('td');

    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => startLocationEdit(loc));
    actionsTd.append(editBtn);

    const toggleBtn = document.createElement('button');
    toggleBtn.textContent = loc.active ? 'Deactivate' : 'Activate';
    toggleBtn.addEventListener('click', () => toggleLocationActive(loc.id, !loc.active));
    actionsTd.append(toggleBtn);

    const deleteBtn = document.createElement('button');
    deleteBtn.textContent = 'Delete';
    deleteBtn.className = 'danger';
    deleteBtn.addEventListener('click', () => deleteLocationRow(loc.id, locationRowLabel(loc)));
    actionsTd.append(deleteBtn);

    tr.append(actionsTd);
    return tr;
}

async function loadAdminLocations() {
    const body = document.getElementById('adminLocBody');
    if (!body) return;
    body.textContent = '';
    const type = document.getElementById('adminLocType').value;
    const res = await authFetch(`/.netlify/functions/admin-locations?type=${encodeURIComponent(type)}`).catch(() => null);
    if (!res?.ok) return;
    const { locations } = await res.json();
    locations.forEach((loc) => body.append(renderAdminLocationRow(loc)));
}

function startLocationEdit(loc) {
    const typeSelect = document.getElementById('adminLocType');
    typeSelect.value = loc.type;
    typeSelect.disabled = true;
    renderLocationFields(loc.type, loc);
    document.getElementById('adminLocEditId').value = loc.id;
    document.getElementById('adminLocSubmitBtn').textContent = 'Save changes';
    document.getElementById('adminLocCancelBtn').hidden = false;
    document.getElementById('adminLocFormMessage').textContent = '';
}

function cancelLocationEdit() {
    const typeSelect = document.getElementById('adminLocType');
    typeSelect.disabled = false;
    document.getElementById('adminLocEditId').value = '';
    document.getElementById('adminLocSubmitBtn').textContent = 'Add location';
    document.getElementById('adminLocCancelBtn').hidden = true;
    renderLocationFields(typeSelect.value);
    document.getElementById('adminLocFormMessage').textContent = '';
}

async function toggleLocationActive(id, active) {
    await authFetch('/.netlify/functions/admin-locations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, active }),
    }).catch(() => null);
    loadAdminLocations();
    refreshMapData();
}

async function deleteLocationRow(id, label) {
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    await authFetch(`/.netlify/functions/admin-locations?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).catch(() => null);
    loadAdminLocations();
    refreshMapData();
}

function switchAdminTab(tabId) {
    document.querySelectorAll('.admin-tab-panel').forEach((el) => { el.hidden = el.id !== tabId; });
    document.querySelectorAll('.admin-tab').forEach((btn) => { btn.classList.toggle('active', btn.dataset.tab === tabId); });
    if (tabId === 'adminUsersTab') loadAdminUsers();
    else loadAdminLocations();
}

function openAdminPanel() {
    if (getSession()?.role !== 'admin') return;
    document.getElementById('adminOverlay').hidden = false;
    cancelLocationEdit();
    switchAdminTab('adminUsersTab');
}

function closeAdminPanel() {
    const overlay = document.getElementById('adminOverlay');
    if (overlay) overlay.hidden = true;
}

function setupAdminLocationsPanel() {
    const typeSelect = document.getElementById('adminLocType');
    const form = document.getElementById('adminLocForm');
    const message = document.getElementById('adminLocFormMessage');
    if (!typeSelect || !form) return;

    renderLocationFields(typeSelect.value);

    typeSelect.addEventListener('change', () => {
        renderLocationFields(typeSelect.value);
        loadAdminLocations();
    });

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const type = typeSelect.value;
        const fields = collectLocationFields(type);
        const editId = document.getElementById('adminLocEditId').value;
        if (message) message.textContent = '';

        const res = editId
            ? await authFetch('/.netlify/functions/admin-locations', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: Number(editId), ...fields }),
            }).catch(() => null)
            : await authFetch('/.netlify/functions/admin-locations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type, ...fields }),
            }).catch(() => null);

        if (res?.ok) {
            cancelLocationEdit();
            loadAdminLocations();
            refreshMapData();
            return;
        }

        const data = await res?.json().catch(() => null);
        if (message) message.textContent = data?.message || 'Could not save location.';
    });
}

function setupAdminPanel() {
    const form = document.getElementById('adminCreateForm');
    const message = document.getElementById('adminFormMessage');

    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const username = document.getElementById('adminNewUsername').value.trim();
        const temp_password = document.getElementById('adminNewPassword').value;
        const role = document.getElementById('adminNewRole').value;
        if (message) message.textContent = '';

        const res = await authFetch('/.netlify/functions/admin-users', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, temp_password, role }),
        }).catch(() => null);

        if (res?.ok) {
            form.reset();
            document.getElementById('adminNewRole').value = 'user';
            loadAdminUsers();
            return;
        }

        const data = await res?.json().catch(() => null);
        if (message) message.textContent = data?.message || 'Could not create user.';
    });

    setupAdminLocationsPanel();
}

function setupAccessPrompt() {
    const form = document.getElementById('accessForm');
    const usernameInput = document.getElementById('accessUsername');
    const input = document.getElementById('accessToken');
    const message = document.getElementById('accessMessage');
    const rememberCheckbox = document.getElementById('rememberUsername');
    const submitBtn = form?.querySelector('button[type="submit"]');

    const remembered = localStorage.getItem(REMEMBERED_USERNAME_KEY);
    if (remembered && usernameInput) {
        usernameInput.value = remembered;
        if (rememberCheckbox) rememberCheckbox.checked = true;
    }

    (remembered ? input : usernameInput)?.focus();
    form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const username = (usernameInput?.value || '').trim();
        const password = input?.value || '';
        if (!username || !password) return;

        if (submitBtn) submitBtn.disabled = true;
        if (message) message.textContent = '';

        let success = false;
        try {
            const res = await fetch('/.netlify/functions/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });
            const data = await res.json();
            if (res.ok) {
                success = true;
                setSession(data);
                if (data.must_change_password) await forcePasswordChange(data);
                const adminToggle = document.getElementById('adminToggle');
                if (adminToggle) adminToggle.hidden = getSession()?.role !== 'admin';
            }
        } catch {
            success = false;
        }

        logAccessAttempt(success);

        if (success) {
            if (rememberCheckbox?.checked) localStorage.setItem(REMEMBERED_USERNAME_KEY, username);
            else localStorage.removeItem(REMEMBERED_USERNAME_KEY);
            unlockMap();
            return;
        }

        if (submitBtn) submitBtn.disabled = false;
        if (message) message.textContent = 'Invalid username or password.';
        input?.select();
    });
}

function brandOf(p) {
    if (p.type === 'MP') return 'MP';
    if (p.type.startsWith('BWW')) return 'BWW';
    if (p.type.startsWith('Dunkin')) return 'Dunkin';
    return 'Other';
}

function isVisibleLocation(p) {
    return BRAND_FILTERS[brandOf(p)] !== false;
}

function visibleLocations() {
    return ALL.filter(isVisibleLocation);
}

function locationSearchLabel(p) {
    const name = p.name || p.id || 'Unnamed location';
    if (p.type === 'MP') return `MP - ${p.id}`;
    if (p.type.startsWith('Dunkin') && name.startsWith('Dunkin')) return name;
    return `${p.type} - ${name}`;
}
if (!window.L) {
    const mapElement = document.getElementById('map');
    const filterSummary = document.getElementById('filterSummary');
    const message = 'Leaflet did not load. Check your internet connection or allow the Leaflet CDN scripts.';
    if (mapElement) {
        mapElement.innerHTML = `<div class="map-error">${message}</div>`;
    }
    if (filterSummary) {
        filterSummary.textContent = message;
    }
    throw new Error(message);
}

// Initialize the map centered on the area
const map = L.map('map', {
    wheelDebounceTime: 35,
    wheelPxPerZoomLevel: 90,
    zoomAnimation: true,
    markerZoomAnimation: true,
    fadeAnimation: true,
    zoomSnap: 0.5,
    zoomDelta: 0.5
}).setView([40.25, -75.05], 8);

const THEME_KEY = 'pcgMapTheme';
const COUNTY_GEOJSON_URL = 'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json';

// Add map tiles
const lightTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
});
const darkTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'dark-tiles',
    attribution: '&copy; OpenStreetMap contributors'
});
let activeTiles = lightTiles.addTo(map);
map.createPane('countyPane');
map.getPane('countyPane').style.zIndex = 330;

// Array to hold markers
const markers = [];
const pinnedAddressMarkers = [];
const pinnedAddressCircles = [];
let pinnedAddresses = [];
const PINNED_ADDRESSES_KEY = 'bwwMapPinnedAddresses';
let paCountyLayer = null;
const countyLayerById = new Map();
let mapCountySummaryEl = null;
let selectedCountyId = '';
let mapIsAnimating = false;

map.on('zoomstart movestart', () => {
    mapIsAnimating = true;
});

map.on('zoomend moveend', () => {
    setTimeout(() => {
        mapIsAnimating = false;
    }, 80);
});

function countyHasLocations(feature) {
    const counts = feature?.properties?.pcgCounts;
    return counts && (counts.MP > 0 || counts.BWW > 0 || counts.Dunkin > 0);
}

function countyStyle(feature) {
    const dark = document.body.classList.contains('dark-mode');
    const highlighted = countyHasLocations(feature);
    return {
        color: dark ? '#d0a337' : '#a97b22',
        weight: highlighted ? 2 : 0.8,
        opacity: highlighted ? (dark ? 0.92 : 0.82) : 0.28,
        fillColor: dark ? '#d0a337' : '#fbbf24',
        fillOpacity: highlighted ? (dark ? 0.16 : 0.18) : 0.02,
        pane: 'countyPane'
    };
}

function countyHoverStyle() {
    const dark = document.body.classList.contains('dark-mode');
    return {
        color: dark ? '#f8d675' : '#7c4f12',
        weight: 2.4,
        fillOpacity: dark ? 0.18 : 0.2
    };
}

function pointInRing(point, ring) {
    const x = point.lng;
    const y = point.lat;
    let inside = false;

    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0];
        const yi = ring[i][1];
        const xj = ring[j][0];
        const yj = ring[j][1];
        const intersects = ((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
        if (intersects) inside = !inside;
    }

    return inside;
}

function pointInPolygonCoordinates(point, polygon) {
    if (!pointInRing(point, polygon[0])) return false;
    return !polygon.slice(1).some(hole => pointInRing(point, hole));
}

function pointInFeature(point, feature) {
    const geometry = feature?.geometry;
    if (!geometry) return false;
    if (geometry.type === 'Polygon') {
        return pointInPolygonCoordinates(point, geometry.coordinates);
    }
    if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.some(polygon => pointInPolygonCoordinates(point, polygon));
    }
    return false;
}

function countyCounts(feature) {
    const counts = { MP: 0, BWW: 0, Dunkin: 0 };
    ALL.forEach(point => {
        if (!pointInFeature(point, feature)) return;
        const brand = brandOf(point);
        if (counts[brand] !== undefined) {
            counts[brand] += 1;
        }
    });
    return counts;
}

function countyName(feature) {
    const name = feature?.properties?.NAME || 'Pennsylvania county';
    return name.endsWith('County') || name === 'Philadelphia' ? name : `${name} County`;
}

function countyState(feature) {
    const fips = String(feature?.id || '');
    if (fips.startsWith('42')) return 'Pennsylvania';
    if (fips.startsWith('34')) return 'New Jersey';
    return 'County';
}

function updateCountySummary(feature = null) {
    const out = document.getElementById('countySummary');
    const detail = document.getElementById('countyDetailList');

    if (!feature) {
        const selectedLayer = selectedCountyId ? countyLayerById.get(selectedCountyId) : null;
        if (selectedLayer?.feature) {
            feature = selectedLayer.feature;
        } else {
            if (out) {
                out.textContent = 'Select a county to view details.';
            }
            if (detail) {
                detail.classList.remove('is-open');
                detail.innerHTML = '';
            }
            return;
        }
    }

    if (!feature) {
        if (out) {
            out.textContent = 'Select a county to view details.';
        }
        if (detail) {
            detail.classList.remove('is-open');
            detail.innerHTML = '';
        }
        return;
    }

    const counts = feature.properties.pcgCounts;
    const pinCount = pinnedItemsForCounty(feature).length;
    const text = `${countyName(feature)} includes ${counts.MP} MP, ${counts.BWW} BWW, ${counts.Dunkin} Dunkin, and ${pinCount} pinned addresses.`;
    if (out) {
        out.textContent = text;
    }
    if (detail) {
        detail.innerHTML = countyDetailHtml(feature);
        detail.classList.add('is-open');
    }
    if (mapCountySummaryEl) {
        mapCountySummaryEl.innerHTML = `
            <b>${escapeHtml(countyName(feature))}</b>
            <span>${escapeHtml(countyState(feature))}</span>
            <small>${counts.MP} MP · ${counts.BWW} BWW · ${counts.Dunkin} Dunkin</small>
        `;
        mapCountySummaryEl.classList.add('is-active');
    }
}

function setupCountySummaryControl() {
    const control = L.control({ position: 'topright' });
    control.onAdd = () => {
        mapCountySummaryEl = L.DomUtil.create('div', 'map-county-summary');
        L.DomEvent.disableClickPropagation(mapCountySummaryEl);
        return mapCountySummaryEl;
    };
    control.addTo(map);
}

function locationNamesForCounty(feature, brand) {
    return ALL
        .filter(p => brandOf(p) === brand && pointInFeature(p, feature))
        .map(p => p.name || p.id);
}

function locationItemsForCounty(feature, brand) {
    return ALL
        .map((location, index) => ({ location, index }))
        .filter(({ location }) => brandOf(location) === brand && pointInFeature(location, feature));
}

function pinnedItemsForCounty(feature) {
    return pinnedAddresses
        .map((pin, index) => ({ pin, index }))
        .filter(({ pin }) => pointInFeature(pin, feature));
}

function countyDescription(feature) {
    const parts = [];
    const mp = locationNamesForCounty(feature, 'MP');
    const bww = locationNamesForCounty(feature, 'BWW');
    const dunkin = locationNamesForCounty(feature, 'Dunkin');

    if (mp.length) parts.push(`MP: ${mp.join(', ')}`);
    if (bww.length) parts.push(`BWW: ${bww.join(', ')}`);
    if (dunkin.length) parts.push(`Dunkin: ${dunkin.join(', ')}`);

    return parts.join(' | ');
}

function renderCountyList(features) {
    const select = document.getElementById('countySelect');
    if (!select) return;

    if (!features.length) {
        select.innerHTML = '<option value="">No counties found</option>';
        return;
    }

    const sorted = [...features].sort((a, b) => countyName(a).localeCompare(countyName(b)));
    select.innerHTML = '<option value="">Select a county...</option>' + sorted.map(feature => {
        return `<option value="${escapeHtml(feature.id)}">${escapeHtml(countyName(feature))}</option>`;
    }).join('');
}

function countyDetailHtml(feature) {
    const counts = feature.properties.pcgCounts;
    const pins = pinnedItemsForCounty(feature);
    const buildSection = (label, iconCls, brand) => {
        const items = locationItemsForCounty(feature, brand);
        if (!items.length) return '';
        return `
            <div class="county-detail-section">
                <div class="county-detail-heading"><i class="${iconCls}"></i>${escapeHtml(label)}</div>
                ${items.map(({ location, index }) => `
                    <button class="county-detail-item county-location-jump" type="button" onclick="jumpToCountyLocation(${index})">
                        <span>${escapeHtml(location.name || location.id)}</span>
                        <i class="fas fa-location-crosshairs"></i>
                    </button>
                `).join('')}
            </div>
        `;
    };
    const buildPinnedSection = () => {
        if (!pins.length) return '';
        return `
            <div class="county-detail-section">
                <div class="county-detail-heading"><i class="fas fa-map-pin"></i>Pinned Addresses</div>
                ${pins.map(({ pin, index }) => `
                    <button class="county-detail-item county-location-jump" type="button" onclick="jumpToPinnedLocation(${index})">
                        <span>${escapeHtml(pin.note || pin.address)}</span>
                        <i class="fas fa-location-crosshairs"></i>
                    </button>
                `).join('')}
            </div>
        `;
    };

    return `
        <div class="county-detail-head">
            <span class="county-list-state">${escapeHtml(countyState(feature))}</span>
            <span class="county-list-title">${escapeHtml(countyName(feature))}</span>
            <span class="county-count-strip">
                <span>${counts.MP} MP</span>
                <span>${counts.BWW} BWW</span>
                <span>${counts.Dunkin} Dunkin</span>
                <span>${pins.length} Pins</span>
            </span>
        </div>
        ${buildSection('MP', 'fas fa-building', 'MP')}
        ${buildSection('Buffalo Wild Wings', 'fas fa-utensils', 'BWW')}
        ${buildSection('Dunkin', 'fas fa-mug-hot', 'Dunkin')}
        ${buildPinnedSection()}
    `;
}

function focusCounty(countyId) {
    if (!countyId) {
        selectedCountyId = '';
        updateCountySummary();
        return;
    }

    const layer = countyLayerById.get(String(countyId));
    const feature = layer?.feature;
    if (!layer || !feature) return;

    selectedCountyId = String(countyId);
    const select = document.getElementById('countySelect');
    if (select) {
        select.value = String(countyId);
    }
    updateCountySummary(feature);
    closeCountyDetail();
    map.fitBounds(layer.getBounds(), { padding: [48, 48] });
}

function jumpToCountyLocation(index) {
    const location = ALL[index];
    if (!location) return;

    const locationSearch = document.getElementById('locationSearch');
    if (locationSearch) {
        locationSearch.value = String(index);
    }

    if (location.type === 'MP') {
        const radiusCenter = document.getElementById('radiusCenter');
        if (radiusCenter) {
            radiusCenter.value = String(index);
        }
        updateRadiusMilesInput();
        updateMPSummary();
    }

    centerLocation(index, true);
    pulseLocationMarker(index);
}

function jumpToPinnedLocation(index) {
    const pin = pinnedAddresses[index];
    const marker = pinnedAddressMarkers[index];
    if (!pin) return;

    map.setView([pin.lat, pin.lng], 16, { animate: true });
    setTimeout(() => {
        marker?.openPopup();
        map.panTo([pin.lat, pin.lng], { animate: true });
    }, 260);

    const markerElement = marker?.getElement();
    if (markerElement) {
        markerElement.classList.remove('location-marker-pulse');
        void markerElement.offsetWidth;
        markerElement.classList.add('location-marker-pulse');
        setTimeout(() => markerElement.classList.remove('location-marker-pulse'), 1200);
    }
}

function refreshSelectedCountySummary() {
    const selectedLayer = selectedCountyId ? countyLayerById.get(selectedCountyId) : null;
    if (selectedLayer?.feature) {
        updateCountySummary(selectedLayer.feature);
    }
}

function openCountyDetail(feature, bounds) {
    const panel    = document.getElementById('countyDetailPanel');
    const titleEl  = document.getElementById('cdpTitle');
    const badgeEl  = document.getElementById('cdpBadge');
    const bodyEl   = document.getElementById('cdpBody');
    if (!panel) return;

    const inCounty = ALL.filter(p => pointInFeature(p, feature));
    const mp     = inCounty.filter(p => p.type === 'MP');
    const bww    = inCounty.filter(p => p.type.startsWith('BWW'));
    const dunkin = inCounty.filter(p => p.type.startsWith('Dunkin'));

    const stateFull = countyState(feature);
    badgeEl.textContent = stateFull;
    titleEl.textContent = countyName(feature);

    const buildSection = (label, iconCls, items) => {
        if (!items.length) return '';
        const rows = items.map(p => `<div class="cdp-item">${escapeHtml(p.name || p.id)}</div>`).join('');
        return `<div class="cdp-section"><div class="cdp-section-label"><i class="${iconCls}"></i> ${escapeHtml(label)}</div>${rows}</div>`;
    };

    bodyEl.innerHTML =
        buildSection('MP', 'fas fa-building', mp) +
        buildSection('Buffalo Wild Wings', 'fas fa-utensils', bww) +
        buildSection('Dunkin\'', 'fas fa-mug-hot', dunkin);

    panel.classList.add('is-open');

    if (bounds) {
        map.fitBounds(bounds, { padding: [48, 48] });
    }
}

function closeCountyDetail() {
    document.getElementById('countyDetailPanel')?.classList.remove('is-open');
}

map.on('click', closeCountyDetail);

async function loadCountyHighlights() {
    try {
        const response = await fetch(COUNTY_GEOJSON_URL, { cache: 'force-cache' });
        if (!response.ok) throw new Error('county fetch failed');
        const geojson = await response.json();
        const highlightedStates = new Set(['34', '42']);
        const countyFeatures = {
            type: 'FeatureCollection',
            features: geojson.features
                .filter(feature => highlightedStates.has(String(feature.id || '').slice(0, 2)))
                .map(feature => ({
                    ...feature,
                    properties: {
                        ...feature.properties,
                        pcgCounts: countyCounts(feature)
                    }
                }))
                .filter(feature => {
                    const c = feature.properties.pcgCounts;
                    return c.MP + c.BWW + c.Dunkin > 0;
                })
        };

        if (paCountyLayer) {
            map.removeLayer(paCountyLayer);
        }
        countyLayerById.clear();
        renderCountyList(countyFeatures.features);
        updateCountySummary();

        paCountyLayer = L.geoJSON(countyFeatures, {
            pane: 'countyPane',
            interactive: true,
            bubblingMouseEvents: false,
            style: countyStyle,
            onEachFeature: (feature, layer) => {
                countyLayerById.set(String(feature.id), layer);
                layer.on({
                    mouseover: () => {
                        if (mapIsAnimating) return;
                        layer.setStyle(countyHoverStyle());
                        updateCountySummary(feature);
                    },
                    mouseout: () => {
                        if (mapIsAnimating) return;
                        paCountyLayer?.resetStyle(layer);
                        updateCountySummary();
                    },
                    click: (event) => {
                        L.DomEvent.stopPropagation(event);
                        selectedCountyId = String(feature.id);
                        const select = document.getElementById('countySelect');
                        if (select) {
                            select.value = selectedCountyId;
                        }
                        updateCountySummary(feature);
                        closeCountyDetail();
                    }
                });
            }
        }).addTo(map);
    } catch (e) {
        const filterSummary = document.getElementById('filterSummary');
        const countySummary = document.getElementById('countySummary');
        if (filterSummary) {
            filterSummary.textContent = `${filterSummary.textContent} County boundaries could not load.`;
        }
        if (countySummary) {
            countySummary.textContent = 'County details could not load.';
        }
    }
}

// Function to create a custom icon for markers
function icon(p) {
    let iconClass = 'fas fa-utensils';
    let markerClass = 'map-icon-marker--bww-pa';

    if (p.type === 'MP') {
        iconClass = 'fas fa-building';
        markerClass = 'map-icon-marker--mp';
    } else if (p.type.startsWith('Dunkin')) {
        iconClass = p.combo ? 'fas fa-cake-candles' : 'fas fa-mug-hot';
        markerClass = p.combo ? 'map-icon-marker--combo' : 'map-icon-marker--dunkin';
    } else if (p.name && p.name.includes('GO')) {
        iconClass = 'fas fa-star';
        markerClass = 'map-icon-marker--bww-go';
    } else if (p.type === 'BWW NJ') {
        markerClass = 'map-icon-marker--bww-nj';
    }

    return L.divIcon({
        className: '',
        html: `<span class="map-icon-marker ${markerClass}" aria-hidden="true"><i class="${iconClass}"></i></span>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -16]
    });
}

function pinnedAddressIcon() {
    return L.divIcon({
        className: '',
        html: '<span class="map-pin-marker" aria-hidden="true"><i class="fas fa-map-pin"></i></span>',
        iconSize: [32, 32],
        iconAnchor: [16, 31],
        popupAnchor: [0, -28]
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
}

function formatMiles(miles) {
    const value = Number.isFinite(miles) ? miles : 0;
    return `${value} ${value === 1 ? 'mile' : 'miles'}`;
}

// Function removed - no longer needed with new icon system

// Function to generate popup content for a location
function popup(p) {
    const radiusLine = p.type === 'MP' && Number.isFinite(p.radiusMiles)
        ? `<br>${p.radiusMiles} ${p.radiusMiles === 1 ? 'mile' : 'miles'} radius`
        : '';
    const regionLine = p.region ? `<br>${p.region}` : '';

    return `<b>${p.name || p.id}</b><br>${p.type}${radiusLine}${regionLine}<br>${p.address || ''}<br>${p.lat.toFixed(6)}, ${p.lng.toFixed(6)}`;
}

// Function to add markers to the map
function addMarkers() {
    // Remove existing markers
    markers.forEach(m => {
        if (m) map.removeLayer(m);
    });
    markers.length = 0;

    // Add new markers
    ALL.forEach((p, i) => {
        if (!isVisibleLocation(p)) return;

        const m = L.marker([p.lat, p.lng], { icon: icon(p) }).addTo(map).bindPopup(popup(p), {
            autoPan: false,
            keepInView: false
        });
        // When marker is clicked, select it for radius and route appropriately
        m.on('click', () => {
            const locationSearch = document.getElementById('locationSearch');
            if (locationSearch) {
                locationSearch.value = i;
            }

            if (p.type === 'MP') {
                document.getElementById('radiusCenter').value = i;
                updateRadiusMilesInput();
                updateMPSummary();
                document.getElementById('from').value = i;
            } else {
                document.getElementById('to').value = i;
            }
        });
        markers[i] = m;
    });

    // Fit map to bounds of all markers
    const visible = visibleLocations();
    if (visible.length > 0) {
        map.fitBounds(L.latLngBounds(visible.map(p => [p.lat, p.lng])), { padding: [30, 30] });
    }
}

// Function to populate select dropdowns with locations
function fillSelects() {
    const fromSelect = document.getElementById('from');
    const toSelect = document.getElementById('to');
    const radiusSelect = document.getElementById('radiusCenter');

    fromSelect.innerHTML = '';
    ALL_MP.filter(isVisibleLocation).forEach((p) => {
        const option = document.createElement('option');
        const globalIndex = ALL.indexOf(p);
        option.value = globalIndex;
        option.textContent = `${p.type} - ${p.id}`;
        fromSelect.appendChild(option);
    });

    toSelect.innerHTML = '';
    ALL_DESTINATIONS.filter(isVisibleLocation).forEach(p => {
        const option = document.createElement('option');
        const globalIndex = ALL.indexOf(p);
        option.value = globalIndex;
        option.textContent = locationSearchLabel(p);
        toSelect.appendChild(option);
    });

    const addressTarget = document.getElementById('addressTarget');
    addressTarget.innerHTML = '';
    ALL.filter(isVisibleLocation).forEach((p) => {
        const option = document.createElement('option');
        option.value = ALL.indexOf(p);
        option.textContent = locationSearchLabel(p);
        addressTarget.appendChild(option);
    });

    radiusSelect.innerHTML = '';
    ALL_MP.filter(isVisibleLocation).forEach(p => {
        const option = document.createElement('option');
        const globalIndex = ALL.indexOf(p);
        option.value = globalIndex;
        option.textContent = `${p.type} - ${p.id} (${p.radiusMiles} mi radius)`;
        radiusSelect.appendChild(option);
    });

    fillLocationSearchSelect();

    updateRadiusMilesInput();
    updateMPSummary();

    // Default end point to first visible destination
    const visibleDestinations = ALL_DESTINATIONS.filter(isVisibleLocation);
    if (visibleDestinations.length > 0) {
        document.getElementById('to').value = ALL.indexOf(visibleDestinations[0]);
    }

    // Update pin counts display
    document.getElementById('counts').innerHTML = `${MP.length} MP pins<br>${BWW_PA.length} PA BWW pins<br>${BWW_NJ.length} NJ BWW pins<br>${DUNKIN.length} Dunkin pins`;
    updateFilterSummary();
}

function fillLocationSearchSelect() {
    const locationSearch = document.getElementById('locationSearch');
    const summary = document.getElementById('locationSearchSummary');
    const button = document.querySelector('button[onclick="jumpToLocation()"]');
    if (!locationSearch) return;

    const previousValue = locationSearch.value;
    const matches = ALL
        .filter(isVisibleLocation)
        .filter(p => brandOf(p) === locationSearchType);

    locationSearch.innerHTML = '';
    matches.forEach((p) => {
        const option = document.createElement('option');
        option.value = ALL.indexOf(p);
        option.textContent = locationSearchLabel(p);
        locationSearch.appendChild(option);
    });

    if (matches.some(p => String(ALL.indexOf(p)) === previousValue)) {
        locationSearch.value = previousValue;
    }

    if (summary) {
        summary.textContent = matches.length
            ? `${matches.length} matching ${locationSearchType}.`
            : `No matching ${locationSearchType}. Check the visible location filters above.`;
    }

    if (button) {
        button.disabled = matches.length === 0;
    }
}

function applySearchLocationFilter() {
    locationSearchType = document.querySelector('input[name="locationSearchType"]:checked')?.value || 'MP';
    fillLocationSearchSelect();
}

function updateFilterSummary() {
    const out = document.getElementById('filterSummary');
    if (!out) return;

    const visible = visibleLocations();
    const counts = {
        MP: visible.filter(p => brandOf(p) === 'MP').length,
        BWW: visible.filter(p => brandOf(p) === 'BWW').length,
        Dunkin: visible.filter(p => brandOf(p) === 'Dunkin').length
    };

    out.textContent = `${visible.length} visible: ${counts.MP} MP, ${counts.BWW} BWW, ${counts.Dunkin} Dunkin.`;
}

function applyLocationFilters() {
    BRAND_FILTERS.MP = document.getElementById('filterMP')?.checked ?? true;
    BRAND_FILTERS.BWW = document.getElementById('filterBWW')?.checked ?? true;
    BRAND_FILTERS.Dunkin = document.getElementById('filterDunkin')?.checked ?? true;

    addMarkers();
    drawAllMPRadii();
    if (!BRAND_FILTERS.MP) {
        clearRadius();
    }
    fillSelects();
    updateMPSummary();
}

// Variables for radius circles and route line
const mpRadiusCircles = [];
let radiusCircle = null, routeLine = null;

// Temporary radius the user drew around the selected MP (null = show the saved radius only).
let customRadiusMiles = null;
const MIN_CUSTOM_RADIUS = 0.1;
const MAX_CUSTOM_RADIUS = 50;

function getSelectedRadiusCenter() {
    return ALL[+document.getElementById('radiusCenter').value];
}

function getSelectedRadiusMiles() {
    return parseFloat(document.getElementById('radiusMiles').value);
}

function updateRadiusMilesInput() {
    const radiusMilesInput = document.getElementById('radiusMiles');
    const p = getSelectedRadiusCenter();

    removeRadiusCircle();
    customRadiusMiles = null;
    setRadiusMessage('');
    radiusMilesInput.readOnly = false;

    if (p && p.type === 'MP' && Number.isFinite(p.radiusMiles)) {
        radiusMilesInput.value = p.radiusMiles;
        radiusMilesInput.title = `${p.id} has a saved radius of ${p.radiusMiles} miles. Type a larger radius and press Draw to compare.`;
    } else {
        radiusMilesInput.title = '';
    }
}

function setRadiusMessage(text) {
    const message = document.getElementById('radiusMessage');
    if (message) message.textContent = text;
}

function getNearest(items, point) {
    return items
        .map(item => ({ ...item, distance: haversine(point, item) }))
        .sort((a, b) => a.distance - b.distance)[0];
}

function formatNearest(label, item) {
    return item
        ? `<b>Closest ${label}:</b> ${item.name || item.id} (${item.distance.toFixed(2)} mi)<br>`
        : `<b>Closest ${label}:</b> no visible ${label} locations<br>`;
}

function updateMPSummary() {
    const out = document.getElementById('mpSummary');
    const mp = getSelectedRadiusCenter();
    if (!out) return;
    if (!mp || mp.type !== 'MP') {
        out.textContent = 'Select an MP to see territory details.';
        return;
    }

    const visibleBWW = ALL_BWW.filter(isVisibleLocation);
    const visibleDunkin = ALL_DUNKIN.filter(isVisibleLocation);
    const nearestBWW = getNearest(visibleBWW, mp);
    const nearestDunkin = getNearest(visibleDunkin, mp);
    const radius = customRadiusMiles ?? mp.radiusMiles;
    const bwwInRadius = visibleBWW.filter(bww => haversine(mp, bww) <= radius);
    const dunkinInRadius = visibleDunkin.filter(dunkin => haversine(mp, dunkin) <= radius);
    const radiusLine = customRadiusMiles === null
        ? `<b>Radius:</b> ${formatMiles(mp.radiusMiles)}`
        : `<b>Custom radius:</b> ${formatMiles(customRadiusMiles)} (saved: ${formatMiles(mp.radiusMiles)})`;

    out.innerHTML = `
        <b>${mp.id}</b><br>
        ${radiusLine}<br>
        <b>BWW inside radius:</b> ${bwwInRadius.length}<br>
        <b>Dunkin inside radius:</b> ${dunkinInRadius.length}<br>
        ${formatNearest('BWW', nearestBWW)}
        ${formatNearest('Dunkin', nearestDunkin)}
    `;
}

function pulseLocationMarker(index) {
    const markerElement = markers[index]?.getElement();
    if (!markerElement) return;

    markerElement.classList.remove('location-marker-pulse');
    void markerElement.offsetWidth;
    markerElement.classList.add('location-marker-pulse');
    setTimeout(() => markerElement.classList.remove('location-marker-pulse'), 1200);
}

function centerLocation(index, openPopup = false) {
    const p = ALL[index];
    if (!p) return;

    map.setView([p.lat, p.lng], 16, { animate: true });

    if (openPopup) {
        setTimeout(() => {
            markers[index]?.openPopup();
            map.panTo([p.lat, p.lng], { animate: true });
        }, 260);
    }
}

function previewSelectedLocation() {
    const index = +document.getElementById('locationSearch').value;
    if (!ALL[index]) return;
    centerLocation(index);
    pulseLocationMarker(index);
}

function jumpToLocation() {
    const index = +document.getElementById('locationSearch').value;
    const p = ALL[index];
    if (!p) return;

    centerLocation(index, true);
    pulseLocationMarker(index);

    if (p.type === 'MP') {
        document.getElementById('radiusCenter').value = index;
        updateRadiusMilesInput();
        updateMPSummary();
    }
}

function togglePresentationView() {
    document.body.classList.toggle('presentation-mode');
    const enabled = document.body.classList.contains('presentation-mode');
    const button = document.getElementById('presentationToggle');
    if (button) {
        button.innerHTML = enabled
            ? '<i class="fas fa-compress"></i>'
            : '<i class="fas fa-expand"></i>';
        button.title = enabled ? 'Exit Presentation' : 'Presentation View';
    }
    setTimeout(() => map.invalidateSize(), 250);
}

function spawnThemeFX(cx, cy, newDark) {
    const colors = ['#d4af37', '#FFD700', '#f8d675', '#e7c765', '#ffffff'];
    for (let i = 0; i < 18; i++) {
        const p = document.createElement('div');
        p.className = 'theme-particle';
        const angle = (i / 18) * Math.PI * 2;
        const dist = 60 + Math.random() * 100;
        p.style.left = (cx - 3) + 'px';
        p.style.top  = (cy - 3) + 'px';
        p.style.setProperty('--px', Math.cos(angle) * dist + 'px');
        p.style.setProperty('--py', Math.sin(angle) * dist + 'px');
        p.style.background = colors[i % colors.length];
        const size = (4 + Math.random() * 6) + 'px';
        p.style.width  = size;
        p.style.height = size;
        p.style.animationDelay = (Math.random() * 0.1) + 's';
        document.body.appendChild(p);
        setTimeout(() => p.remove(), 800);
    }

    const overlay = document.createElement('div');
    overlay.className = 'theme-ripple';
    overlay.style.background = newDark ? '#0f0f0f' : '#f0ede8';
    overlay.style.setProperty('--rx', cx + 'px');
    overlay.style.setProperty('--ry', cy + 'px');
    document.body.appendChild(overlay);
    return overlay;
}

function setDarkMode(enabled, persist = true, origin = null) {
    if (persist && origin) {
        const rect = origin.getBoundingClientRect();
        const cx = Math.round(rect.left + rect.width / 2);
        const cy = Math.round(rect.top + rect.height / 2);
        const overlay = spawnThemeFX(cx, cy, enabled);
        setTimeout(() => {
            document.body.classList.toggle('dark-mode', enabled);
            applyDarkModeState(enabled, persist);
            setTimeout(() => overlay.remove(), 400);
        }, 320);
    } else {
        document.body.classList.toggle('dark-mode', enabled);
        applyDarkModeState(enabled, persist);
    }
}

function applyDarkModeState(enabled, persist) {
    if (activeTiles) {
        map.removeLayer(activeTiles);
    }
    activeTiles = enabled ? darkTiles : lightTiles;
    activeTiles.addTo(map);
    if (paCountyLayer) {
        paCountyLayer.setStyle(countyStyle);
    }

    const icon = enabled ? '<i class="fas fa-sun"></i>' : '<i class="fas fa-moon"></i>';
    const title = enabled ? 'Switch to Light Mode' : 'Switch to Dark Mode';
    ['themeToggle', 'accessThemeToggle'].forEach(id => {
        const btn = document.getElementById(id);
        if (btn) { btn.innerHTML = icon; btn.title = title; }
    });

    if (persist) {
        localStorage.setItem(THEME_KEY, enabled ? 'dark' : 'light');
    }
}

function toggleDarkMode() {
    const button = document.getElementById('themeToggle') || document.getElementById('accessThemeToggle');
    setDarkMode(!document.body.classList.contains('dark-mode'), true, button);
}

function drawAllMPRadii() {
    mpRadiusCircles.forEach(circle => map.removeLayer(circle));
    mpRadiusCircles.length = 0;

    if (!BRAND_FILTERS.MP) return;

    ALL_MP.forEach(p => {
        if (!Number.isFinite(p.radiusMiles)) return;

        const circle = L.circle([p.lat, p.lng], {
            radius: p.radiusMiles * 1609.344,
            color: '#1e3a8a',
            fillColor: '#60a5fa',
            fillOpacity: 0.08,
            weight: 1.5
        }).addTo(map);

        circle.bindPopup(`<b>${p.id}</b><br>Fixed territory radius: ${p.radiusMiles} miles`);
        mpRadiusCircles.push(circle);
    });
}

// Function to draw radius circle around selected center
function drawRadius() {
    const p = getSelectedRadiusCenter();
    const miles = getSelectedRadiusMiles();
    if (!p) return;

    if (!Number.isFinite(miles) || miles < MIN_CUSTOM_RADIUS || miles > MAX_CUSTOM_RADIUS) {
        setRadiusMessage(`Enter a radius between ${MIN_CUSTOM_RADIUS} and ${MAX_CUSTOM_RADIUS} miles.`);
        return;
    }
    setRadiusMessage('');
    removeRadiusCircle();

    const isMP = p.type === 'MP' && Number.isFinite(p.radiusMiles);
    customRadiusMiles = isMP && miles !== p.radiusMiles ? miles : null;

    radiusCircle = L.circle([p.lat, p.lng], {
        radius: miles * 1609.344, // Convert miles to meters
        color: isMP ? '#b45309' : '#111827',
        dashArray: isMP ? '6 6' : null,
        fillColor: isMP ? '#f59e0b' : '#60a5fa',
        fillOpacity: 0.12,
        weight: 2
    }).addTo(map);
    map.fitBounds(radiusCircle.getBounds());
    updateMPSummary();
}

function removeRadiusCircle() {
    if (radiusCircle) {
        map.removeLayer(radiusCircle);
        radiusCircle = null;
    }
}

// Function to clear the radius circle (and reset an MP back to its saved radius)
function clearRadius() {
    removeRadiusCircle();
    customRadiusMiles = null;
    setRadiusMessage('');

    const p = getSelectedRadiusCenter();
    if (p && p.type === 'MP' && Number.isFinite(p.radiusMiles)) {
        document.getElementById('radiusMiles').value = p.radiusMiles;
    }
    updateMPSummary();
}

// Function to clear the route line and reset result text
function clearRoute() {
    if (routeLine) {
        map.removeLayer(routeLine);
        routeLine = null;
    }
    document.getElementById('routeResult').textContent = 'No route calculated yet.';
    const addressOut = document.getElementById('addressRouteResult');
    if (addressOut) {
        addressOut.textContent = 'No address route calculated yet.';
    }
}

// Function to calculate straight-line distance using Haversine formula
function haversine(a, b) {
    const R = 3958.8; // Earth's radius in miles
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLon = (b.lng - a.lng) * Math.PI / 180;
    const lat1 = a.lat * Math.PI / 180;
    const lat2 = b.lat * Math.PI / 180;
    const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(x));
}

// Function to geocode a single user address using Nominatim
async function geocodeAddress(address) {
    const q = encodeURIComponent(address);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}&countrycodes=US&viewbox=-80.8,42.7,-73.6,38.5`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const d = await r.json();
    if (d && d[0]) {
        return { lat: parseFloat(d[0].lat), lng: parseFloat(d[0].lon) };
    }
    return null;
}

function savePinnedAddresses() {
    localStorage.setItem(PINNED_ADDRESSES_KEY, JSON.stringify(pinnedAddresses));
}

function loadPinnedAddresses() {
    try {
        pinnedAddresses = JSON.parse(localStorage.getItem(PINNED_ADDRESSES_KEY)) || [];
    } catch (e) {
        pinnedAddresses = [];
    }
    pinnedAddresses = pinnedAddresses.map(pin => ({
        ...pin,
        note: pin.note || '',
        radiusMiles: Number.isFinite(pin.radiusMiles) ? pin.radiusMiles : 0
    }));
    renderPinnedAddresses();
}

function renderPinnedAddresses() {
    pinnedAddressMarkers.forEach(marker => map.removeLayer(marker));
    pinnedAddressMarkers.length = 0;
    pinnedAddressCircles.forEach(circle => map.removeLayer(circle));
    pinnedAddressCircles.length = 0;

    const list = document.getElementById('pinnedAddressesList');
    if (!list) return;

    if (pinnedAddresses.length === 0) {
        list.textContent = 'No pinned addresses yet.';
    } else {
        list.innerHTML = pinnedAddresses.map(pin => `
            <div class="pinned-address-item">
                <div class="pinned-address-text">
                    ${pin.note ? `<b>${escapeHtml(pin.note)}</b><br>` : ''}
                    ${escapeHtml(pin.address)}<br>
                    ${formatMiles(pin.radiusMiles)} radius
                </div>
                <button class="pinned-address-remove" onclick="removePinnedAddress('${pin.id}')">Remove</button>
            </div>
        `).join('');
    }

    pinnedAddresses.forEach(pin => {
        if (Number.isFinite(pin.radiusMiles) && pin.radiusMiles > 0) {
            const circle = L.circle([pin.lat, pin.lng], {
                radius: pin.radiusMiles * 1609.344,
                color: '#16a34a',
                fillColor: '#86efac',
                fillOpacity: 0.1,
                weight: 1.5
            }).addTo(map);
            pinnedAddressCircles.push(circle);
        }

        const marker = L.marker([pin.lat, pin.lng], { icon: pinnedAddressIcon() }).addTo(map);
        marker.bindPopup(`
            <b>Pinned address</b><br>
            ${pin.note ? `${escapeHtml(pin.note)}<br>` : ''}
            ${escapeHtml(pin.address)}<br>
            ${formatMiles(pin.radiusMiles)} radius<br>
            ${pin.lat.toFixed(6)}, ${pin.lng.toFixed(6)}<br>
            <button class="popup-remove-pin" onclick="removePinnedAddress('${pin.id}')">Remove pin</button>
        `);
        pinnedAddressMarkers.push(marker);
    });

    refreshSelectedCountySummary();
}

async function pinAddress() {
    const addressInput = document.getElementById('pinnedAddress');
    const noteInput = document.getElementById('pinnedAddressNote');
    const radiusInput = document.getElementById('pinnedAddressRadius');
    const out = document.getElementById('pinResult');
    const address = addressInput.value.trim();
    const note = noteInput.value.trim();
    const radiusMiles = parseFloat(radiusInput.value);

    if (!address) {
        out.textContent = 'Please enter an address to pin in the Pin address section.';
        return;
    }

    if (!Number.isFinite(radiusMiles) || radiusMiles < 0) {
        out.textContent = 'Please enter a valid radius of 0 miles or more.';
        return;
    }

    out.textContent = 'Geocoding address for pin...';
    const point = await geocodeAddress(address);
    if (!point) {
        out.textContent = 'Address not found. Please try a different address.';
        return;
    }

    const pin = {
        id: `pin-${Date.now()}-${Math.round(Math.random() * 100000)}`,
        address,
        note,
        radiusMiles,
        lat: point.lat,
        lng: point.lng
    };

    pinnedAddresses.push(pin);
    savePinnedAddresses();
    renderPinnedAddresses();
    map.setView([pin.lat, pin.lng], Math.max(map.getZoom(), 14));
    pinnedAddressMarkers[pinnedAddressMarkers.length - 1]?.openPopup();
    addressInput.value = '';
    noteInput.value = '';
    out.innerHTML = `<b>Pinned:</b> ${escapeHtml(address)}<br><b>Radius:</b> ${formatMiles(radiusMiles)}`;
}

function removePinnedAddress(id) {
    pinnedAddresses = pinnedAddresses.filter(pin => pin.id !== id);
    savePinnedAddresses();
    renderPinnedAddresses();
}

async function findNearestLocations() {
    const address = document.getElementById('closestAddress').value.trim();
    const out = document.getElementById('closestMPResult');

    if (!address) {
        out.textContent = 'Please enter an address to check.';
        return;
    }

    out.textContent = 'Geocoding address...';
    const point = await geocodeAddress(address);
    if (!point) {
        out.textContent = 'Address not found. Please try a different address.';
        return;
    }

    const closestMP = getNearest(ALL_MP.filter(isVisibleLocation), point);
    const closestBWW = getNearest(ALL_BWW.filter(isVisibleLocation), point);
    const closestDunkin = getNearest(ALL_DUNKIN.filter(isVisibleLocation), point);
    const insideRadius = closestMP ? closestMP.distance <= closestMP.radiusMiles : false;

    out.innerHTML = `
        ${formatNearest('MP', closestMP)}
        ${formatNearest('BWW', closestBWW)}
        ${formatNearest('Dunkin', closestDunkin)}
        <b>Inside closest MP radius:</b> ${insideRadius ? 'Yes' : 'No'}<br>
        <span class="result-muted">${closestMP ? `${closestMP.id} radius is ${formatMiles(closestMP.radiusMiles)}.` : 'Turn on MP locations to check territory radius.'}</span>
    `;
}

// Route from a typed address to a selected location
async function routeAddress() {
    clearRoute();
    const address = document.getElementById('startAddress').value.trim();
    const target = ALL[+document.getElementById('addressTarget').value];
    const out = document.getElementById('addressRouteResult');

    if (!address) {
        out.textContent = 'Please enter a start address.';
        return;
    }

    if (!target) {
        out.textContent = 'Please select a destination.';
        return;
    }

    out.textContent = 'Geocoding address...';
    const start = await geocodeAddress(address);
    if (!start) {
        out.textContent = 'Address not found. Please try a different address.';
        return;
    }

    const straight = haversine(start, target);
    out.innerHTML = 'Routing...';

    try {
        const url = `https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${target.lng},${target.lat}?overview=full&geometries=geojson`;
        const r = await fetch(url);
        if (!r.ok) throw new Error('route failed');
        const data = await r.json();
        const rt = data.routes[0];
        const mi = rt.distance / 1609.344;
        const min = rt.duration / 60;

        routeLine = L.geoJSON(rt.geometry, { style: { color: '#111827', weight: 4 } }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });

        out.innerHTML = `<b>Driving:</b> ${mi.toFixed(1)} miles · ${Math.round(min)} minutes<br><b>Straight-line:</b> ${straight.toFixed(1)} miles`;
    } catch (e) {
        routeLine = L.polyline([[start.lat, start.lng], [target.lat, target.lng]], {
            color: '#111827',
            dashArray: '6,6',
            weight: 3
        }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
        out.innerHTML = `Routing service unavailable.<br><b>Straight-line distance:</b> ${straight.toFixed(1)} miles`;
    }
}

// Function to calculate driving route using OSRM
async function routeDrive() {
    clearRoute();
    const a = ALL[+document.getElementById('from').value];
    const b = ALL[+document.getElementById('to').value];
    const out = document.getElementById('routeResult');
    if (!a || !b) {
        out.textContent = 'Please select a start and end location.';
        return;
    }

    const straight = haversine(a, b);
    out.innerHTML = 'Calculating...';

    try {
        // Fetch route from OSRM API
        const url = `https://router.project-osrm.org/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
        const r = await fetch(url);
        if (!r.ok) throw new Error('route failed');
        const data = await r.json();
        const rt = data.routes[0];
        const mi = rt.distance / 1609.344; // Convert meters to miles
        const min = rt.duration / 60; // Convert seconds to minutes

        // Add route line to map
        routeLine = L.geoJSON(rt.geometry, { style: { color: '#111827', weight: 4 } }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });

        // Display results
        out.innerHTML = `<b>Driving:</b> ${mi.toFixed(1)} miles · ${Math.round(min)} minutes<br><b>Straight-line:</b> ${straight.toFixed(1)} miles`;
    } catch (e) {
        // Fallback to straight line if routing fails
        routeLine = L.polyline([[a.lat, a.lng], [b.lat, b.lng]], {
            color: '#111827',
            dashArray: '6,6',
            weight: 3
        }).addTo(map);
        map.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
        out.innerHTML = `Routing service unavailable.<br><b>Straight-line distance:</b> ${straight.toFixed(1)} miles`;
    }
}

// Function to geocode a single address using Nominatim
async function geocodeOne(p) {
    const q = encodeURIComponent(p.address);
    const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${q}&countrycodes=US`;
    const r = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const d = await r.json();
    if (d && d[0]) {
        p.lat = parseFloat(d[0].lat);
        p.lng = parseFloat(d[0].lon);
        return true;
    }
    return false;
}

// Function to geocode all BWW locations and update markers
async function geocodeBWW() {
    const status = document.getElementById('geoStatus');
    let ok = 0;
    const total = BWW_PA.length + BWW_NJ.length;
    for (const p of [...BWW_PA, ...BWW_NJ]) {
        status.textContent = `Geocoding ${ok + 1} of ${total}...`;
        try {
            if (await geocodeOne(p)) ok++;
        } catch (e) {}
        // Rate limit to avoid hitting API limits
        await new Promise(res => setTimeout(res, 1100));
    }
    status.textContent = `Updated ${ok} of ${total} BWW coordinates.`;
    // Refresh markers and selects with new coordinates
    addMarkers();
    fillSelects();
}

async function initializeApp() {
    setDarkMode(localStorage.getItem(THEME_KEY) !== 'light', false);

    try {
        const loaded = await loadLocationData();
        if (!loaded) return;
    } catch (e) {
        console.error('Failed to load location data:', e);
        lockApp('Your session expired. Please log in again.');
        return;
    }

    addMarkers();
    fillSelects();
    await loadCountyHighlights();
    drawAllMPRadii();
    loadPinnedAddresses();
}

async function refreshMapData() {
    try {
        await loadLocationData();
        addMarkers();
        fillSelects();
        drawAllMPRadii();
    } catch {
        // Session likely expired; the next authenticated action will re-lock the app.
    }
}

setupAccessPrompt();
setupAdminPanel();

document.getElementById('radiusCenter').addEventListener('change', updateRadiusMilesInput);
document.getElementById('radiusCenter').addEventListener('change', updateMPSummary);
document.getElementById('radiusCenter').addEventListener('change', () => {
    const selectedIndex = +document.getElementById('radiusCenter').value;
    const p = ALL[selectedIndex];
    if (!p) return;

    centerLocation(selectedIndex, true);
});

// Autocomplete for address inputs, biased toward PA/NJ while staying inside the US.
const addressSearchParams = new URLSearchParams({
    format: 'json',
    addressdetails: '1',
    limit: '6',
    countrycodes: 'US',
    viewbox: '-80.8,42.7,-73.6,38.5'
});

function setupAddressAutocomplete(inputId, suggestionsId) {
    const input = document.getElementById(inputId);
    const suggestions = document.getElementById(suggestionsId);
    let debounceTimer;

    if (!input || !suggestions) return;

    input.addEventListener('input', function() {
        clearTimeout(debounceTimer);
        const query = this.value.trim();
        if (query.length < 3) {
            suggestions.style.display = 'none';
            return;
        }
        debounceTimer = setTimeout(async () => {
            try {
                const params = new URLSearchParams(addressSearchParams);
                params.set('q', query);
                const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
                if (!response.ok) throw new Error('address search failed');
                const results = await response.json();

                suggestions.innerHTML = '';
                if (results && results.length > 0) {
                    results.slice(0, 6).forEach((result) => {
                        const div = document.createElement('div');
                        div.textContent = result.display_name;
                        div.addEventListener('click', () => {
                            input.value = result.display_name;
                            suggestions.style.display = 'none';
                        });
                        suggestions.appendChild(div);
                    });
                    suggestions.style.display = 'block';
                } else {
                    suggestions.style.display = 'none';
                }
            } catch (e) {
                suggestions.style.display = 'none';
            }
        }, 250);
    });

    input.addEventListener('blur', () => {
        setTimeout(() => {
            suggestions.style.display = 'none';
        }, 150);
    });

    input.addEventListener('focus', function() {
        if (this.value.trim().length >= 3 && suggestions.children.length > 0) {
            suggestions.style.display = 'block';
        }
    });
}

setupAddressAutocomplete('startAddress', 'addressSuggestions');
setupAddressAutocomplete('closestAddress', 'closestAddressSuggestions');
setupAddressAutocomplete('pinnedAddress', 'pinnedAddressSuggestions');
