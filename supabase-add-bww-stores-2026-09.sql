-- ============================================================
-- PCG Map -- add newly opened Buffalo Wild Wings locations
-- Found via a re-scan of BWW's public sitemap (Sept 2026); each
-- one below was individually checked against BWW's own site,
-- Yelp/Tripadvisor, and news coverage (incl. njbiz.com's BWW GO
-- reporting) before being added. Run this once in the Supabase
-- SQL editor.
-- ============================================================

-- ── Fix: the existing "Princeton, NJ" pin had no real street
-- address and sat at the town's center. BWW's sitemap confirms
-- this is the store at 3465 US-1 (West Windsor Twp; BWW files it
-- under the Princeton mailing city).
UPDATE locations
SET address = '3465 US 1, Princeton, NJ', lat = 40.2666215, lng = -74.7165141
WHERE type = 'bww_nj' AND name = 'Buffalo Wild Wings - Princeton, NJ';

-- ── New Buffalo Wild Wings – Pennsylvania ────────────────────

INSERT INTO locations (type, name, address, lat, lng) VALUES
('bww_pa', 'Buffalo Wild Wings - Chambersburg', '540 Walker Road, Chambersburg, PA', 39.9398721, -77.6250836),
('bww_pa', 'Buffalo Wild Wings - Collingdale', '1207 Macdade Blvd, Collingdale, PA', 39.9156121, -75.2686489),
('bww_pa', 'Buffalo Wild Wings - Cranberry Township', '20215 Route 19, Cranberry Township, PA', 40.6863621, -80.1029438),
('bww_pa', 'Buffalo Wild Wings - Erie', '2099 Interchange Road, Erie, PA', 42.0645086, -80.105218),
('bww_pa', 'Buffalo Wild Wings - Gibsonia', '500 Grandview Crossing Drive, Gibsonia, PA', 40.6300671, -79.9695004),
('bww_pa', 'Buffalo Wild Wings - Greensburg', '6215 Route 30, Greensburg, PA', 40.3024514, -79.5443274),
('bww_pa', 'Buffalo Wild Wings - Hanover', '81 Wilson Avenue, Hanover, PA', 39.8287464, -76.9959427),
('bww_pa', 'Buffalo Wild Wings GO - Harrisburg', '4207 Union Deposit Road, Harrisburg, PA', 40.2783711, -76.8169562),
('bww_pa', 'Buffalo Wild Wings - Hermitage', '3100 Shenango Valley Freeway, Hermitage, PA', 41.2333897, -80.44868),
('bww_pa', 'Buffalo Wild Wings - Lebanon', '1960 Quentin Rd, Lebanon, PA', 40.3090316, -76.4228665),
('bww_pa', 'Buffalo Wild Wings - Manchester', '255 Glen Drive, Manchester, PA', 40.0446227, -76.7257857),
('bww_pa', 'Buffalo Wild Wings - Mechanicsburg', '6385 Carlisle Pike, Mechanicsburg, PA', 40.2476657, -77.0018147),
('bww_pa', 'Buffalo Wild Wings GO - Philadelphia', '6410 Frankford Avenue, Philadelphia, PA', 40.0292882, -75.0575744),
('bww_pa', 'Buffalo Wild Wings - Pittsburgh', '480 Home Drive, Pittsburgh, PA', 40.4406968, -80.0025666),
('bww_pa', 'Buffalo Wild Wings GO - Royersford', '1810 E Ridge Pike, Royersford, PA', 40.2119388, -75.4959807),
('bww_pa', 'Buffalo Wild Wings - Selinsgrove', '249 Marketplace Blvd, Selinsgrove, PA', 40.7993524, -76.8619072),
('bww_pa', 'Buffalo Wild Wings - Shippensburg', '209 South Conestoga Drive, Shippensburg, PA', 40.0507198, -77.5205485),
('bww_pa', 'Buffalo Wild Wings - State College', '134 South Garner Street, State College, PA', 40.797267, -77.8564774),
('bww_pa', 'Buffalo Wild Wings - Temple', '4304 N 5th Street Hwy, Temple, PA', 40.3978011, -75.9276079),
('bww_pa', 'Buffalo Wild Wings - Washington', '50 Old Mill Blvd, Washington, PA', 40.1901063, -80.2202724),
('bww_pa', 'Buffalo Wild Wings - Waynesboro', '1910 E Main St, Waynesboro, PA', 39.7523129, -77.5717886),
('bww_pa', 'Buffalo Wild Wings - West Chester', '1502 West Chester Pike, West Chester, PA', 39.9653597, -75.5265919),
('bww_pa', 'Buffalo Wild Wings - West Mifflin', '9996 Mountain View Drive, West Mifflin, PA', 40.3473917, -79.9422094),
('bww_pa', 'Buffalo Wild Wings - Wilkins Township', '3469 William Penn Highway, Wilkins Township, PA', 40.4306434, -79.8097926),
('bww_pa', 'Buffalo Wild Wings - Williamsport', '25 Liberty Lane, Williamsport, PA', 41.2411556, -77.0011096),
('bww_pa', 'Buffalo Wild Wings - York', '320 Town Center Drive, York, PA', 39.9681884, -76.7703221),
('bww_pa', 'Buffalo Wild Wings - York', '105 North Northern Way, York, PA', 39.975583, -76.6732703);

-- ── New Buffalo Wild Wings – New Jersey ──────────────────────

INSERT INTO locations (type, name, address, lat, lng) VALUES
('bww_nj', 'Buffalo Wild Wings GO - Barnegat', '770 Lighthouse Drive, Barnegat, NJ', 39.758796, -74.2547867),
('bww_nj', 'Buffalo Wild Wings GO - Bayonne', '205 Lefante Way, Bayonne, NJ', 40.6687721, -74.1076208),
('bww_nj', 'Buffalo Wild Wings - Brick', '2770 Hooper Avenue, Brick, NJ', 40.0555227, -74.1364364),
('bww_nj', 'Buffalo Wild Wings - Bridgewater', '970 US 22, Bridgewater, NJ', 40.5813887, -74.6100531),
('bww_nj', 'Buffalo Wild Wings - Eatontown', '180 Route 35 South, Eatontown, NJ', 40.2962222, -74.0509725),
('bww_nj', 'Buffalo Wild Wings GO - Fair Lawn', '21-08 Maple Avenue, Fair Lawn, NJ', 40.9442387, -74.1403638),
('bww_nj', 'Buffalo Wild Wings GO - Hainesport', '1520 NJ Route 38, Hainesport, NJ', 39.9815035, -74.807838),
('bww_nj', 'Buffalo Wild Wings GO - Haskell', '1353 Ringwood Ave, Haskell, NJ', 41.0184451, -74.2971463),
('bww_nj', 'Buffalo Wild Wings - Hazlet Township', '3054 Route 35, Hazlet Township, NJ', 40.4292165, -74.1648999),
('bww_nj', 'Buffalo Wild Wings GO - Hillsborough', '626 US 206, Hillsborough, NJ', 40.5000973, -74.6468457),
('bww_nj', 'Buffalo Wild Wings - Iselin', '625 US 1 South, Iselin, NJ', 40.5569501, -74.3089297),
('bww_nj', 'Buffalo Wild Wings GO - Jersey City', '2825 John F Kennedy Blvd, Jersey City, NJ', 40.731854, -74.067059),
('bww_nj', 'Buffalo Wild Wings GO - Kearny', '190 Passaic Avenue, Kearny, NJ', 40.7597002, -74.1600364),
('bww_nj', 'Buffalo Wild Wings - Linden', '1701 West Edgar Road, Linden, NJ', 40.614188, -74.254549),
('bww_nj', 'Buffalo Wild Wings GO - Manahawkin', '650 Route 72 West, Manahawkin, NJ', 39.690518, -74.2486427),
('bww_nj', 'Buffalo Wild Wings - Marlboro', '167 US 9 South, Marlboro, NJ', 40.3499593, -74.3074645),
('bww_nj', 'Buffalo Wild Wings - Mays Landing', '4311 Black Horse Pike, Mays Landing, NJ', 39.452786, -74.724695),
('bww_nj', 'Buffalo Wild Wings GO - Midland Park', '76 Godwin Avenue, Midland Park, NJ', 40.984603, -74.137389),
('bww_nj', 'Buffalo Wild Wings - Millville', '2164 North 2nd Street, Millville, NJ', 39.4226786, -75.0404988),
('bww_nj', 'Buffalo Wild Wings - North Brunswick', '2241 Route 1 South, North Brunswick, NJ', 40.4539249, -74.476545),
('bww_nj', 'Buffalo Wild Wings - Parsippany', '1540 US Highway 46 W, Parsippany, NJ', 40.8623835, -74.4032354),
('bww_nj', 'Buffalo Wild Wings - Piscataway', '1315 Centennial Avenue, Piscataway, NJ', 40.5524895, -74.4544016),
('bww_nj', 'Buffalo Wild Wings - Rockaway', '343 Mount Hope Avenue, Rockaway, NJ', 40.9034795, -74.5492041),
('bww_nj', 'Buffalo Wild Wings GO - Saddle Brook', '487 Market Street, Saddle Brook, NJ', 40.8980742, -74.1001839),
('bww_nj', 'Buffalo Wild Wings - Secaucus', '470 Harmon Meadow Blvd, Secaucus, NJ', 40.7897983, -74.0441321),
('bww_nj', 'Buffalo Wild Wings - Toms River', '2 Route 37 West, Toms River, NJ', 39.9659336, -74.2053188),
('bww_nj', 'Buffalo Wild Wings GO - Warren', '14 Mount Bethel Road, Warren, NJ', 40.8480291, -74.8827487),
('bww_nj', 'Buffalo Wild Wings - Wayne', '1400 Willowbrook Mall, Wayne, NJ', 40.8892699, -74.2597442),
('bww_nj', 'Buffalo Wild Wings GO - West Caldwell', '776 Bloomfield Ave, West Caldwell, NJ', 40.8458476, -74.2875722);

-- ── Mark these as reviewed so they drop off Admin > New BWW
-- stores (they were pending from the automated weekly scan).
UPDATE bww_scan_stores SET status = 'approved', lat = v.lat, lng = v.lng, reviewed_at = now()
FROM (VALUES
    ('1766', 39.758796, -74.2547867),
    ('2008', 40.6687721, -74.1076208),
    ('948', 40.0555227, -74.1364364),
    ('949', 40.5813887, -74.6100531),
    ('1358', 40.2962222, -74.0509725),
    ('1790', 40.9442387, -74.1403638),
    ('1997', 39.9815035, -74.807838),
    ('1771', 41.0184451, -74.2971463),
    ('2034', 40.4292165, -74.1648999),
    ('1950', 40.5000973, -74.6468457),
    ('1146', 40.5569501, -74.3089297),
    ('1824', 40.731854, -74.067059),
    ('1781', 40.7597002, -74.1600364),
    ('1151', 40.614188, -74.254549),
    ('1768', 39.690518, -74.2486427),
    ('1467', 40.3499593, -74.3074645),
    ('900', 39.452786, -74.724695),
    ('2017', 40.984603, -74.137389),
    ('823', 39.4226786, -75.0404988),
    ('688', 40.4539249, -74.476545),
    ('1365', 40.8623835, -74.4032354),
    ('2018', 40.5524895, -74.4544016),
    ('1420', 40.2666215, -74.7165141),
    ('1377', 40.9034795, -74.5492041),
    ('1793', 40.8980742, -74.1001839),
    ('1067', 40.7897983, -74.0441321),
    ('1090', 39.9659336, -74.2053188),
    ('2004', 40.8480291, -74.8827487),
    ('1568', 40.8892699, -74.2597442),
    ('1998', 40.8458476, -74.2875722),
    ('1485', 39.9398721, -77.6250836),
    ('2025', 39.9156121, -75.2686489),
    ('784', 40.6863621, -80.1029438),
    ('498', 42.0645086, -80.105218),
    ('165', 40.6300671, -79.9695004),
    ('854', 40.3024514, -79.5443274),
    ('864', 39.8287464, -76.9959427),
    ('1943', 40.2783711, -76.8169562),
    ('1124', 41.2333897, -80.44868),
    ('1890', 40.3090316, -76.4228665),
    ('1957', 40.0446227, -76.7257857),
    ('867', 40.2476657, -77.0018147),
    ('1762', 40.0292882, -75.0575744),
    ('10', 40.4406968, -80.0025666),
    ('1961', 40.2119388, -75.4959807),
    ('1406', 40.7993524, -76.8619072),
    ('1989', 40.0507198, -77.5205485),
    ('1876', 40.797267, -77.8564774),
    ('2046', 40.3978011, -75.9276079),
    ('1132', 40.1901063, -80.2202724),
    ('2026', 39.7523129, -77.5717886),
    ('1985', 39.9653597, -75.5265919),
    ('782', 40.3473917, -79.9422094),
    ('786', 40.4306434, -79.8097926),
    ('927', 41.2411556, -77.0011096),
    ('1233', 39.9681884, -76.7703221),
    ('852', 39.975583, -76.6732703)
) AS v(store_id, lat, lng)
WHERE bww_scan_stores.store_id = v.store_id;

-- ── Stores this could not pin-point to an exact street address ──
-- (Nominatim had no match for the address; these use the town's
-- center instead. Worth spot-checking on the map and nudging the
-- pin if it lands off the actual plaza/road.)
--   Buffalo Wild Wings - Eatontown (180 Route 35 South, Eatontown, NJ)
--   Buffalo Wild Wings - Hazlet Township (3054 Route 35, Hazlet Township, NJ)
--   Buffalo Wild Wings GO - Manahawkin (650 Route 72 West, Manahawkin, NJ)
--   Buffalo Wild Wings - Mays Landing (4311 Black Horse Pike, Mays Landing, NJ)
--   Buffalo Wild Wings - North Brunswick (2241 Route 1 South, North Brunswick, NJ)
--   Buffalo Wild Wings - Parsippany (1540 US Highway 46 W, Parsippany, NJ)
--   Buffalo Wild Wings - Gibsonia (500 Grandview Crossing Drive, Gibsonia, PA)
--   Buffalo Wild Wings - Greensburg (6215 Route 30, Greensburg, PA)
--   Buffalo Wild Wings - Hermitage (3100 Shenango Valley Freeway, Hermitage, PA)
--   Buffalo Wild Wings - Pittsburgh (480 Home Drive, Pittsburgh, PA)
--   Buffalo Wild Wings - Selinsgrove (249 Marketplace Blvd, Selinsgrove, PA)
--   Buffalo Wild Wings - Shippensburg (209 South Conestoga Drive, Shippensburg, PA)
--   Buffalo Wild Wings - Williamsport (25 Liberty Lane, Williamsport, PA)
