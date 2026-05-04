// Location data is loaded from the authenticated backend API.
let MP = [];
let BWW_PA = [];
let BWW_NJ = [];
let DUNKIN = [];
let ALL = [];
let ALL_MP = [];
let ALL_BWW = [];
let ALL_DUNKIN = [];
let ALL_DESTINATIONS = [];

const BRAND_FILTERS = {
    MP: true,
    BWW: true,
    Dunkin: true
};

function normalizeLocationData(data) {
    MP = data.mp || [];
    BWW_PA = data.bwwPa || [];
    BWW_NJ = data.bwwNj || [];
    DUNKIN = data.dunkin || [];

    ALL = [
        ...MP.map(x => ({ ...x, type: 'MP', color: '#1e3a8a' })),
        ...BWW_PA.map(x => ({ ...x, type: 'BWW PA', color: '#dc2626' })),
        ...BWW_NJ.map(x => ({ ...x, type: 'BWW NJ', color: '#c2410c' })),
        ...DUNKIN.map(x => ({ ...x, name: `Dunkin #${x.id}`, type: x.combo ? 'Dunkin / Baskin-Robbins' : 'Dunkin', color: x.combo ? '#db2777' : '#f97316' }))
    ];

    ALL_MP = ALL.filter(p => p.type === 'MP');
    ALL_BWW = ALL.filter(p => p.type.startsWith('BWW'));
    ALL_DUNKIN = ALL.filter(p => p.type.startsWith('Dunkin'));
    ALL_DESTINATIONS = ALL.filter(p => p.type !== 'MP');
}

async function loadLocationData() {
    const response = await fetch('/api/locations');
    if (response.status === 401) {
        window.location.href = '/login';
        return false;
    }
    if (!response.ok) {
        throw new Error('Unable to load location data.');
    }
    normalizeLocationData(await response.json());
    return true;
}

async function logoutMap() {
    await fetch('/logout', { method: 'POST' });
    window.location.href = '/login';
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
const map = L.map('map').setView([40.25, -75.05], 8);

const THEME_KEY = 'pcgMapTheme';

// Add map tiles
const lightTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
});
const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
});
let activeTiles = lightTiles.addTo(map);

// Array to hold markers
const markers = [];
const pinnedAddressMarkers = [];
const pinnedAddressCircles = [];
let pinnedAddresses = [];
const PINNED_ADDRESSES_KEY = 'bwwMapPinnedAddresses';

// Function to create a custom icon for markers
function icon(p) {
    let iconClass = '';
    let color = p.color;

    if (p.type === 'MP') {
        iconClass = 'fas fa-building';
    } else if (p.type.startsWith('Dunkin')) {
        iconClass = p.combo ? 'fas fa-ice-cream' : 'fas fa-mug-hot';
    } else if (p.name && p.name.includes('GO')) {
        iconClass = 'fas fa-star';
    } else {
        iconClass = 'fas fa-utensils';
    }

    return L.divIcon({
        className: '',
        html: `<i class="${iconClass}" style="color: ${color}; font-size: 18px;"></i>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9]
    });
}

function pinnedAddressIcon() {
    return L.divIcon({
        className: '',
        html: '<i class="fas fa-map-pin" style="color: #16a34a; font-size: 24px;"></i>',
        iconSize: [24, 24],
        iconAnchor: [12, 24]
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

        const m = L.marker([p.lat, p.lng], { icon: icon(p) }).addTo(map).bindPopup(popup(p));
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
    const locationSearch = document.getElementById('locationSearch');

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
        option.textContent = `${p.type} - ${p.name}`;
        toSelect.appendChild(option);
    });

    const addressTarget = document.getElementById('addressTarget');
    addressTarget.innerHTML = '';
    ALL.filter(isVisibleLocation).forEach((p) => {
        const option = document.createElement('option');
        option.value = ALL.indexOf(p);
        option.textContent = `${p.type} - ${p.name || p.id}`;
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

    if (locationSearch) {
        locationSearch.innerHTML = '';
        ALL.filter(isVisibleLocation).forEach((p) => {
            const option = document.createElement('option');
            option.value = ALL.indexOf(p);
            option.textContent = `${p.type} - ${p.name || p.id}`;
            locationSearch.appendChild(option);
        });
    }

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

function getSelectedRadiusCenter() {
    return ALL[+document.getElementById('radiusCenter').value];
}

function getSelectedRadiusMiles() {
    const p = getSelectedRadiusCenter();
    if (p && p.type === 'MP' && Number.isFinite(p.radiusMiles)) {
        return p.radiusMiles;
    }
    return parseFloat(document.getElementById('radiusMiles').value) || 0;
}

function updateRadiusMilesInput() {
    const radiusMilesInput = document.getElementById('radiusMiles');
    const p = getSelectedRadiusCenter();

    if (p && p.type === 'MP' && Number.isFinite(p.radiusMiles)) {
        radiusMilesInput.value = p.radiusMiles;
        radiusMilesInput.readOnly = true;
        radiusMilesInput.title = `${p.id} has a fixed PDF radius of ${p.radiusMiles} miles.`;
    } else {
        radiusMilesInput.readOnly = false;
        radiusMilesInput.title = '';
    }
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
    const bwwInRadius = visibleBWW.filter(bww => haversine(mp, bww) <= mp.radiusMiles);
    const dunkinInRadius = visibleDunkin.filter(dunkin => haversine(mp, dunkin) <= mp.radiusMiles);

    out.innerHTML = `
        <b>${mp.id}</b><br>
        <b>Radius:</b> ${formatMiles(mp.radiusMiles)}<br>
        <b>BWW inside radius:</b> ${bwwInRadius.length}<br>
        <b>Dunkin inside radius:</b> ${dunkinInRadius.length}<br>
        ${formatNearest('BWW', nearestBWW)}
        ${formatNearest('Dunkin', nearestDunkin)}
    `;
}

function jumpToLocation() {
    const index = +document.getElementById('locationSearch').value;
    const p = ALL[index];
    if (!p) return;

    map.setView([p.lat, p.lng], Math.max(map.getZoom(), 13));
    markers[index]?.openPopup();

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
            ? '<i class="fas fa-compress"></i> Exit Presentation'
            : '<i class="fas fa-expand"></i> Presentation View';
    }
    setTimeout(() => map.invalidateSize(), 250);
}

function setDarkMode(enabled, persist = true) {
    document.body.classList.toggle('dark-mode', enabled);

    if (activeTiles) {
        map.removeLayer(activeTiles);
    }
    activeTiles = enabled ? darkTiles : lightTiles;
    activeTiles.addTo(map);

    const button = document.getElementById('themeToggle');
    if (button) {
        button.innerHTML = enabled
            ? '<i class="fas fa-sun"></i> Light Mode'
            : '<i class="fas fa-moon"></i> Dark Mode';
    }

    if (persist) {
        localStorage.setItem(THEME_KEY, enabled ? 'dark' : 'light');
    }
}

function toggleDarkMode() {
    setDarkMode(!document.body.classList.contains('dark-mode'));
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
    clearRadius();
    const p = getSelectedRadiusCenter();
    const miles = getSelectedRadiusMiles();
    if (!p) return;

    document.getElementById('radiusMiles').value = miles;
    radiusCircle = L.circle([p.lat, p.lng], {
        radius: miles * 1609.344, // Convert miles to meters
        color: '#111827',
        fillColor: '#60a5fa',
        fillOpacity: 0.12,
        weight: 2
    }).addTo(map);
    map.fitBounds(radiusCircle.getBounds());
}

// Function to clear the radius circle
function clearRadius() {
    if (radiusCircle) {
        map.removeLayer(radiusCircle);
        radiusCircle = null;
    }
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
}

async function pinAddress() {
    const addressInput = document.getElementById('pinnedAddress');
    const noteInput = document.getElementById('pinnedAddressNote');
    const radiusInput = document.getElementById('pinnedAddressRadius');
    const out = document.getElementById('addressRouteResult');
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
    setDarkMode(localStorage.getItem(THEME_KEY) === 'dark', false);

    try {
        const loaded = await loadLocationData();
        if (!loaded) return;
    } catch (e) {
        const filterSummary = document.getElementById('filterSummary');
        const message = 'Unable to load location data from the backend.';
        if (filterSummary) {
            filterSummary.textContent = message;
        }
        throw e;
    }

    addMarkers();
    fillSelects();
    drawAllMPRadii();
    loadPinnedAddresses();
}

initializeApp();

document.getElementById('radiusCenter').addEventListener('change', updateRadiusMilesInput);
document.getElementById('radiusCenter').addEventListener('change', updateMPSummary);
document.getElementById('radiusCenter').addEventListener('change', () => {
    const selectedIndex = +document.getElementById('radiusCenter').value;
    const p = ALL[selectedIndex];
    if (!p) return;

    map.setView([p.lat, p.lng], Math.max(map.getZoom(), 13));
    markers[selectedIndex]?.openPopup();
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
