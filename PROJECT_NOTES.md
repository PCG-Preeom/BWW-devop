# People Capital Group Map Notes

This file explains the main HTML, CSS, JavaScript, and server pieces in plain language.

## File Overview

- `index.html` builds the page structure: access screen, sidebar controls, map container, county detail panel, and script imports.
- `styles.css` controls the access screen, sidebar cards, light/dark themes, map markers, popups, county panels, and responsive behavior.
- `script.js` contains the map logic, filters, routing, county tools, pinning, search, theme toggle, and address autocomplete.
- `data.js` provides location data through `window.PCG_LOCATION_DATA`.
- `data.json` is the raw location dataset fallback.
- `server.js` serves the app locally and records access attempts to `logs/access.log`.
- `start-secure-map.bat` starts the local Node server.
- `unnamed.png` is the People Capital Group logo used on the access screen.

## HTML Structure

- `<section class="access-screen">` is the lock screen shown before the access code is entered.
- `<form id="accessForm">` handles the access code form.
- `<main id="wrap">` contains the entire unlocked app.
- `<aside id="panel">` is the left sidebar with all map tools.
- `<section class="side-brand">` is the top sidebar brand/header area with the legend and theme/presentation buttons.
- `Visible Locations` toggles MP, BWW, and Dunkin markers.
- `Location Tools` contains the location type selector, matching-location dropdown, jump button, nearest-location address input, and nearest results.
- `Routing & Distance` contains location-to-location distance and address-to-location route controls.
- `Territory Tools` contains MP radius tools and the county selector/details.
- `Pin Location` lets the user geocode and save a custom pinned address.
- `Pin Counts` and `Advanced Tools` are hidden utility sections.
- `<section id="map">` is the Leaflet map mount point.
- `<div id="countyDetailPanel">` is the floating county detail panel.
- The inline script at the bottom fetches the public IP text for the access-screen warning.

## CSS Notes

- Root variables define the shared palette, including `--bg`, `--panel`, `--surface`, `--text`, `--muted`, `--line`, and accent colors.
- `.access-screen` and `.access-panel` style the private access gate.
- `#wrap`, `#panel`, and `#map` create the app layout.
- `.side-brand`, `.brand-actions`, and `.icon-btn` style the sidebar header and top buttons.
- `.row`, `.tool-card`, and `.section-title` style the sidebar tool sections.
- `.filter-option` styles the visible-location checkbox buttons.
- `.search-type-toggle` styles the MP/BWW/Dunkin segmented control.
- `select`, `input`, `button.primary`, and `button.secondary` style form controls and commands.
- `.result` and `.hint` style output text.
- `.county-detail-list`, `.county-detail-section`, and `.county-location-jump` style the county details and clickable county location rows.
- `.map-icon-marker` and related modifier classes style MP, BWW, Dunkin, combo, and pinned map markers.
- `.location-marker-pulse` and related keyframes create the marker pulse effect after selecting a location.
- `.county-detail-panel` styles the floating county detail panel.
- The final theme blocks near the bottom override earlier styles for the current light/dark sidebar appearance.

## JavaScript Data State

- `MP`, `BWW_PA`, `BWW_NJ`, and `DUNKIN` hold normalized source locations.
- `ALL` is the combined list of every map location.
- `ALL_MP`, `ALL_BWW`, `ALL_DUNKIN`, and `ALL_DESTINATIONS` are convenience filtered lists.
- `BRAND_FILTERS` stores which major brands are visible.
- `locationSearchType` stores the selected search type, currently defaulting to `MP`.
- `map`, `lightTiles`, `darkTiles`, and `activeTiles` manage Leaflet and the active map tile layer.
- `markers` stores Leaflet markers for normal locations.
- `pinnedAddresses`, `pinnedAddressMarkers`, and `pinnedAddressCircles` store saved custom pins.
- `paCountyLayer` stores the county GeoJSON layer.
- `countyLayerById` maps county IDs to their Leaflet layers.
- `selectedCountyId` remembers the currently selected county.
- `mapIsAnimating` prevents expensive county hover work during map movement.

## JavaScript Functions

- `normalizeLocationData(data)`: converts raw data into numeric lat/lng values and builds the combined location arrays.
- `loadLocationData()`: loads location data from `data.js` first, then falls back to `data.json`.
- `unlockMap()`: unlocks the app, initializes map data, and fixes the Leaflet map size.
- `logAccessAttempt(success)`: posts access-attempt metadata to the local server when available.
- `setupAccessPrompt()`: wires the access-code form and unlocks the map after a valid code.
- `brandOf(p)`: returns `MP`, `BWW`, `Dunkin`, or `Other` for a location.
- `isVisibleLocation(p)`: checks if a location passes the active brand filters.
- `visibleLocations()`: returns all currently visible locations.
- `locationSearchLabel(p)`: builds readable labels for the location dropdown.
- `countyHasLocations(feature)`: checks whether a county has any MP/BWW/Dunkin locations.
- `countyStyle(feature)`: returns the normal county polygon style.
- `countyHoverStyle()`: returns the hover style for county polygons.
- `pointInRing(point, ring)`: checks if a point is inside one polygon ring.
- `pointInPolygonCoordinates(point, polygon)`: checks if a point is inside a polygon and outside any holes.
- `pointInFeature(point, feature)`: checks if a point is inside a GeoJSON polygon or multipolygon county.
- `countyCounts(feature)`: counts MP, BWW, and Dunkin locations inside a county.
- `countyName(feature)`: formats a county name.
- `countyState(feature)`: returns Pennsylvania, New Jersey, or County from FIPS data.
- `updateCountySummary(feature)`: updates the sidebar county summary and detail list.
- `setupCountySummaryControl()`: creates the small Leaflet county summary control.
- `locationNamesForCounty(feature, brand)`: returns names for a brand inside a county.
- `locationItemsForCounty(feature, brand)`: returns normal locations plus their global indexes for a county.
- `pinnedItemsForCounty(feature)`: returns pinned addresses inside a county.
- `countyDescription(feature)`: builds a text description of county contents.
- `renderCountyList(features)`: fills the county dropdown.
- `countyDetailHtml(feature)`: builds the sidebar county detail markup, including pins.
- `focusCounty(countyId)`: selects a county, updates the sidebar, and zooms the map to that county.
- `jumpToCountyLocation(index)`: jumps from a county detail row to a normal MP/BWW/Dunkin marker.
- `jumpToPinnedLocation(index)`: jumps from a county detail row to a pinned-address marker.
- `refreshSelectedCountySummary()`: refreshes the selected county after pins are added or removed.
- `openCountyDetail(feature, bounds)`: fills and opens the floating county detail panel.
- `closeCountyDetail()`: closes the floating county detail panel.
- `loadCountyHighlights()`: loads county GeoJSON, filters PA/NJ counties, counts locations, renders county UI, and adds county polygons.
- `icon(p)`: creates the correct Leaflet icon for MP, BWW, Dunkin, combo, and GO locations.
- `pinnedAddressIcon()`: creates the custom icon for saved pins.
- `escapeHtml(value)`: escapes text before inserting it into HTML.
- `formatMiles(miles)`: formats a number as `mile` or `miles`.
- `popup(p)`: builds popup HTML for a normal location marker.
- `addMarkers()`: renders all visible normal location markers and attaches click behavior.
- `fillSelects()`: fills all major dropdowns: routes, address target, radius center, and search.
- `fillLocationSearchSelect()`: fills the location search dropdown based on brand type.
- `applySearchLocationFilter()`: updates `locationSearchType` and refreshes search choices.
- `updateFilterSummary()`: updates the visible-location count text.
- `applyLocationFilters()`: reads checkbox filters, rerenders markers/radii, and updates dropdowns.
- `getSelectedRadiusCenter()`: returns the selected MP for radius tools.
- `getSelectedRadiusMiles()`: returns the selected MP radius or manual radius value.
- `updateRadiusMilesInput()`: keeps the radius input synced with selected MP data.
- `getNearest(items, point)`: finds the closest item to a point.
- `formatNearest(label, item)`: builds nearest-location result text.
- `updateMPSummary()`: shows selected MP territory, nearby BWW/Dunkin, and in-radius counts.
- `pulseLocationMarker(index)`: plays the marker pulse animation.
- `centerLocation(index, openPopup)`: centers and zooms the map on a normal location.
- `previewSelectedLocation()`: previews the selected search location with centering and pulse.
- `jumpToLocation()`: jumps to the selected search location and opens its popup.
- `togglePresentationView()`: hides/shows the sidebar for presentation mode.
- `setDarkMode(enabled, persist)`: switches tile layers and body theme state.
- `toggleDarkMode()`: toggles between light and dark themes.
- `drawAllMPRadii()`: draws fixed radius circles for all visible MP locations.
- `drawRadius()`: draws or updates the selected radius circle.
- `clearRadius()`: removes the manually drawn radius circle.
- `clearRoute()`: removes route lines and resets route result text.
- `haversine(a, b)`: calculates straight-line distance in miles.
- `geocodeAddress(address)`: geocodes a user-entered address with Nominatim.
- `savePinnedAddresses()`: saves pins to localStorage.
- `loadPinnedAddresses()`: loads pins from localStorage and normalizes missing fields.
- `renderPinnedAddresses()`: redraws pinned markers/circles and the pinned-address list.
- `pinAddress()`: geocodes and saves a custom pinned address.
- `removePinnedAddress(id)`: removes a saved pin and refreshes the UI.
- `findNearestLocations()`: geocodes an address and reports nearest MP, BWW, and Dunkin.
- `routeAddress()`: routes from a typed address to a selected destination.
- `routeDrive()`: routes between two selected saved locations.
- `geocodeOne(p)`: geocodes one BWW location from its stored address.
- `geocodeBWW()`: refreshes BWW coordinates one by one.
- `initializeApp()`: loads data, markers, dropdowns, county data, radii, and pins.
- `setupAddressAutocomplete(inputId, suggestionsId)`: adds address autocomplete to an input.

## Server Functions

- `send(res, status, body, headers)`: sends a basic HTTP response.
- `serveFile(res, requestPath)`: safely serves a local static file.
- `readJsonBody(req)`: reads and parses a JSON request body.
- `getClientIp(req)`: extracts the client IP from request headers/socket.
- `appendAccessLog(entry)`: appends one JSON line to `logs/access.log`.
- `localNetworkUrls()`: lists local network URLs for sharing the app on the LAN.
- `handleAccessLog(req, res)`: receives access logs from the frontend.
- `startServer()`: starts the Node HTTP server and prints usable URLs.

## Important Behaviors

- The frontend access code is a convenience gate, not true security by itself.
- Real IP logging only works when the app is opened through `server.js`.
- Pinned addresses are stored in browser localStorage, so they are local to that browser/device.
- County boundaries load from a remote GeoJSON file. If that network request fails, county tools may not populate.
- Routing and geocoding depend on external services, so those tools need internet access.
