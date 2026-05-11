-- ============================================================
-- PCG Map – Supabase setup
-- Run this entire file in the Supabase SQL editor once.
-- ============================================================

-- ── Tables ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS access_tokens (
    id     uuid    DEFAULT gen_random_uuid() PRIMARY KEY,
    token  text    NOT NULL,
    description text,
    active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS locations (
    id            serial  PRIMARY KEY,
    type          text    NOT NULL,       -- 'mp' | 'bww_pa' | 'bww_nj' | 'dunkin'
    external_id   text,                  -- original id for MP and Dunkin rows
    name          text,                  -- BWW locations
    address       text,
    property_name text,                  -- Dunkin nickname
    region        text,                  -- Dunkin region
    lat           float8  NOT NULL,
    lng           float8  NOT NULL,
    radius_miles  float8,                -- MP territory radius
    combo         boolean DEFAULT false, -- Dunkin/Baskin-Robbins combo
    active        boolean DEFAULT true
);

-- ── Row-level security ───────────────────────────────────────

ALTER TABLE access_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations      ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon read active tokens"    ON access_tokens FOR SELECT USING (active = true);
CREATE POLICY "anon read active locations" ON locations      FOR SELECT USING (active = true);

-- ── Access token ─────────────────────────────────────────────
-- Change 'People' to whatever you want the new password to be.

INSERT INTO access_tokens (token, description) VALUES
('People', 'Main access token');

-- ── MP locations ─────────────────────────────────────────────

INSERT INTO locations (type, external_id, lat, lng, radius_miles) VALUES
('mp', 'MP 90574', 40.2541957149049,  -75.0880001725863, 1),
('mp', 'MP 20723', 40.0080063085635,  -75.1727176372791, 1),
('mp', 'MP 20724', 39.9145452021085,  -75.1554917030765, 0.5),
('mp', 'MP 20673', 39.9951025705013,  -75.0931737784802, 1),
('mp', 'MP 20678', 40.0740141116265,  -75.1575861121568, 1.5),
('mp', 'MP 90577', 40.0873896110275,  -74.9608339748005, 1),
('mp', 'MP 91122', 40.2129635176821,  -75.01195462589,   1),
('mp', 'MP 94750', 39.9763606531953,  -75.1194692650701, 0.5),
('mp', 'MP 20693', 39.976494932146,   -75.1580816265739, 0.5),
('mp', 'MP 90582', 40.2322636001077,  -74.9407894586644, 1),
('mp', 'MP 21521', 39.9539052600824,  -75.199227479263,  0.5),
('mp', 'MP 21518', 39.9379431591009,  -75.1667540382082, 0.5),
('mp', 'MP 21520', 39.9186826142142,  -75.1849716018374, 0.5),
('mp', 'MP 20674', 40.0306914380818,  -75.1034135383946, 1),
('mp', 'MP 95024', 40.2459747070055,  -74.7630541149707, 0.75),
('mp', 'MP 20682', 40.2110783778632,  -74.7552723000323, 1.5),
('mp', 'MP 20697', 40.556294071305,   -75.4896127978639, 1),
('mp', 'MP 90560', 40.6748387513354,  -75.3460137037353, 1),
('mp', 'MP 21406', 40.5524942874463,  -75.5923687183309, 1),
('mp', 'MP 90522', 41.2584381158992,  -75.901857032505,  1),
('mp', 'MP 90566', 40.2393244476958,  -75.242141743823,  1),
('mp', 'MP 90570', 40.6788561788995,  -75.1473909672058, 1),
('mp', 'MP 91116', 40.6443483776485,  -75.3470388503772, 1),
('mp', 'MP 91118', 40.2647605615097,  -75.3192244305822, 1),
('mp', 'MP 94747', 40.3177636918695,  -75.3076553069029, 1),
('mp', 'MP 91120', 40.1165378059024,  -75.2864770740739, 1);

-- ── Buffalo Wild Wings – Pennsylvania ────────────────────────

INSERT INTO locations (type, name, address, lat, lng) VALUES
('bww_pa', 'Buffalo Wild Wings - Downingtown',              '103 Quarry Road, Downingtown, PA 19335',                40.0066, -75.6922),
('bww_pa', 'Buffalo Wild Wings - Easton',                   '3798 Dryland Way, Easton, PA 18045',                    40.6706, -75.2867),
('bww_pa', 'Buffalo Wild Wings - Glen Mills',               '920 Baltimore Pike, Glen Mills, PA 19342',              39.8818, -75.531),
('bww_pa', 'Buffalo Wild Wings - King of Prussia',          '690 West Dekalb Pike, King of Prussia, PA 19406',       40.0911, -75.3872),
('bww_pa', 'Buffalo Wild Wings - Lancaster',                '2065 Fruitville Pike, Lancaster, PA 17601',             40.073,  -76.3197),
('bww_pa', 'Buffalo Wild Wings - Langhorne',                '2763 East Lincoln Highway, Langhorne, PA 19047',        40.1836, -74.8802),
('bww_pa', 'Buffalo Wild Wings - Philadelphia Roosevelt Blvd.', '9701 Roosevelt Road, Philadelphia, PA 19114',       40.0813, -75.0218),
('bww_pa', 'Buffalo Wild Wings - Phoenixville',             '1510 Egypt Road, Phoenixville, PA 19460',               40.1334, -75.5329),
('bww_pa', 'Buffalo Wild Wings - Quakertown',               '1465 West Broad Street, Suite 29, Quakertown, PA 18951', 40.441, -75.3609),
('bww_pa', 'Buffalo Wild Wings - Scranton',                 '100 Viewmont Mall, Suite 614, Scranton, PA 18508',      41.4596, -75.6555),
('bww_pa', 'Buffalo Wild Wings - Warrington',               '201 Easton Road #118, Warrington, PA 18976',            40.2245, -75.141),
('bww_pa', 'Buffalo Wild Wings - Whitehall',                '1225 Grape Street, Whitehall, PA 18052',                40.6321, -75.4877),
('bww_pa', 'Buffalo Wild Wings - Wilkes-Barre',             '319 Bear Creek Blvd, Wilkes-Barre, PA 18702',           41.2444, -75.8366);

-- ── Buffalo Wild Wings – New Jersey ──────────────────────────

INSERT INTO locations (type, name, address, lat, lng) VALUES
('bww_nj', 'Buffalo Wild Wings - Princeton, NJ',                    'Princeton, NJ',                                         40.3573, -74.6672),
('bww_nj', 'Buffalo Wild Wings GO - Voorhees, NJ - Echelon Village','1120 White Horse Road, Voorhees, NJ 08043',              39.8466, -74.994),
('bww_nj', 'Buffalo Wild Wings - Watchung, NJ',                     '1599 US Highway 22 West, Watchung, NJ 07069',            40.637,  -74.4406),
('bww_nj', 'Buffalo Wild Wings GO - Sparta, NJ',                    '4 N Village Blvd STE A, Sparta, NJ',                    41.0334, -74.6399),
('bww_nj', 'Buffalo Wild Wings - Flemington, NJ',                   '144 NJ-31 #100, Flemington, NJ 08822',                   40.521,  -74.8592),
('bww_nj', 'Buffalo Wild Wings - Moorestown, NJ',                   '1598 Nixon Dr, Moorestown, NJ 08054',                    39.9444, -74.963);

-- ── Dunkin locations ─────────────────────────────────────────

INSERT INTO locations (type, external_id, address, property_name, region, lat, lng, combo) VALUES
('dunkin', '339616', '1630 W Wadsworth Ave, Philadelphia, PA 19150',    'Wadsworth',                    'Philadelphia',       40.0777, -75.1752, false),
('dunkin', '336372', '2 Township Line Rd, Elkins Park, PA 19027',        NULL,                           'Montgomery County',  40.078,  -75.128,  false),
('dunkin', '345986', '3170 Willits Rd, Philadelphia, PA 19136',          NULL,                           'Philadelphia',       40.0569, -75.0141, false),
('dunkin', '340794', '6190 North Front St, Philadelphia, PA 19120',      'Front',                        'Philadelphia',       40.0438, -75.1195, false),
('dunkin', '345489', '5801 Oxford Ave, Philadelphia, PA 19149',          NULL,                           'Philadelphia',       40.0324, -75.0854, false),
('dunkin', '351099', '15 Bustleton Pike, Feasterville, PA 19053',        'Sonic',                        'Bucks County',       40.1379, -75.0075, false),
('dunkin', '351259', '1069 W County Line Rd, Warminster, PA 18974',      'Rosemore',                     'Bucks County',       40.201,  -75.1214, false),
('dunkin', '302642', '2112 County Line Rd, Huntingdon Valley, PA 19006', 'County Line',                  'Bucks County',       40.1708, -75.0717, false),
('dunkin', '352894', '110 E Street Rd, Feasterville, PA 19053',          'Street Rd',                    'Bucks County',       40.1493, -74.9993, true),
('dunkin', '341350', '1050 Stoney Hill Rd, Yardley, PA 19067',           'Yardley',                      'Bucks County',       40.235,  -74.85,   false),
('dunkin', '337839', '334 Easton Rd, Warrington, PA 18976',              'Warrington',                   'Bucks County',       40.2221, -75.1404, false),
('dunkin', '330338', '5060 Township Line Rd, Drexel Hill, PA 19026',     'Drexel Hill',                  'Delaware County',    39.9538, -75.3227, false),
('dunkin', '337063', '1100 Chester Pike, Sharon Hill, PA 19079',         'Sharon Hill',                  'Delaware County',    39.9094, -75.2732, false),
('dunkin', '343832', '23 E Baltimore Ave, Lansdowne, PA 19050',          'Lansdowne',                    'Delaware County',    39.9387, -75.2712, false),
('dunkin', '304669', '5 Macdade Blvd, Collingdale, PA 19023',            'Collingdale',                  'Delaware County',    39.9172, -75.2652, false),
('dunkin', '355146', '901 Market St, Philadelphia, PA 19107',            'Gallery',                      'Philadelphia',       39.9514, -75.1553, false),
('dunkin', '300496', '7000 Chester Ave, Philadelphia, PA 19142',         'Cobbs Creek',                  'Philadelphia',       39.9236, -75.2453, false),
('dunkin', '341167', '4017 N 5th St, Philadelphia, PA 19140',            '5th Street',                   'Philadelphia',       40.0134, -75.1348, false),
('dunkin', '340870', '221 W Hunting Park Ave, Philadelphia, PA 19140',   'Hunting Park',                 'Philadelphia',       40.0147, -75.1304, false),
('dunkin', '335981', '532 W Lehigh Ave, Philadelphia, PA 19133',         'Lehigh',                       'Philadelphia',       39.9921, -75.1418, false),
('dunkin', '353150', '2749 W Hunting Park Ave, Philadelphia, PA 19129',  'Bakers Square',                'Philadelphia',       40.0077, -75.1744, false),
('dunkin', '351050', '2145 W Allegheny Ave, Philadelphia, PA 19132',     'Allegheny',                    'Philadelphia',       40.0035, -75.1656, false),
('dunkin', '345985', '5051 Wissahickon Ave, Philadelphia, PA 19144',     'Wissahickon',                  'Philadelphia',       40.0199, -75.1744, false),
('dunkin', '356374', '738 Bethlehem Pike, Montgomeryville, PA 18936',    NULL,                           'Montgomery County',  40.2457, -75.2441, false),
('dunkin', '353843', '1110 West End Blvd, Quakertown, PA 18951',         NULL,                           'Bucks County',       40.4167, -75.3442, false),
('dunkin', '353047', '103 South Baringer Ave, Silverdale, PA 18962',     NULL,                           'Bucks County',       40.3476, -75.271,  false),
('dunkin', '340538', '4460 Easton Ave, Bethlehem, PA 18015',             NULL,                           'Northampton County', 40.666,  -75.3079, false),
('dunkin', '343079', '376 W Uwchlan Ave, Downingtown, PA 19335',         'DD-BR Uwchlan / DD Downingtown','Chester County',    40.0324, -75.6777, true),
('dunkin', '342144', '750 Miles Rd, West Chester, PA 19380',             'DD Miles / DD Westchester',    'Chester County',     39.9636, -75.6277, false),
('dunkin', '364295', '80 E Uwchlan Ave, Exton, PA 19341',                'Lionville',                    'Chester County',     40.028,  -75.62,   false),
('dunkin', '365361', '2301 Welsh Rd, Philadelphia, PA 19114',            'Welsh',                        'Philadelphia',       40.0741, -75.0346, false),
('dunkin', '310382', '1619 Grant Ave, Philadelphia, PA 19115',           'Grant',                        'Philadelphia',       40.0863, -75.038,  false),
('dunkin', '332941', '9834 Bustleton Ave, Philadelphia, PA 19115',       'Bustleton',                    'Philadelphia',       40.0931, -75.032,  false),
('dunkin', '343497', '842 Red Lion Rd, Philadelphia, PA 19115',          'Red Lion',                     'Philadelphia',       40.1031, -75.0302, false),
('dunkin', '302446', '10050 Roosevelt Blvd, Philadelphia, PA 19116',     'Little Red Lion',              'Philadelphia',       40.0958, -75.0153, false),
('dunkin', '337079', '2998 A Welsh Rd, Philadelphia, PA 19152',          'Holme Circle',                 'Philadelphia',       40.0735, -75.0341, false),
('dunkin', '304863', '2654 S 18th St, Philadelphia, PA 19145',           '18th St',                      'Philadelphia',       39.918,  -75.178,  false),
('dunkin', '354561', '2640 S Carlisle St, Philadelphia, PA 19145',       'Carlisle',                     'Philadelphia',       39.9173, -75.1726, false),
('dunkin', '332393', '7601 Lindbergh Blvd, Philadelphia, PA 19153',      'Lindbergh',                    'Philadelphia',       39.9049, -75.2384, false),
('dunkin', '358933', '1402 Brace Rd, Cherry Hill, NJ 08034',             'Brace Rd',                     'Camden County, NJ',  39.8911, -75.0186, false),
('dunkin', '354865', '224 W Broad St, Quakertown, PA 18951',             'Quakertown',                   'Bucks County',       40.4409, -75.3362, false),
('dunkin', '353689', '520 Pennsylvania Ave, Fort Washington, PA 19034',  'Fort Washington',              'Montgomery County',  40.134,  -75.206,  false),
('dunkin', '342184', '549 Doylestown Rd, Lansdale, PA 19445',            'Lansdale',                     'Montgomery County',  40.2651, -75.2282, false),
('dunkin', '356316', '2054 Red Lion Rd, Philadelphia, PA 19115',         'Star Alliance',                'Philadelphia',       40.0982, -75.0214, false),
('dunkin', '364412', '8200 Roosevelt Blvd, Philadelphia, PA 19152',      '8200',                         'Philadelphia',       40.0603, -75.0453, false);
