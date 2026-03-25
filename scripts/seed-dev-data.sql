-- seed-dev-data.sql
-- Populates immoradar with realistic Vienna property data for development.
-- Idempotent via ON CONFLICT. Safe to re-run.

BEGIN;

-- ── Scrape runs ──────────────────────────────────────────────────────────────

INSERT INTO scrape_runs (source_id, trigger_type, scope, status, started_at, finished_at, pages_fetched, listings_discovered, raw_snapshots_created, normalized_created)
SELECT s.id, 'manual', 'full', 'succeeded', NOW() - interval '2 hours', NOW() - interval '1 hour', 25, 60, 60, 60
FROM sources s WHERE s.code = 'willhaben'
ON CONFLICT DO NOTHING;

INSERT INTO scrape_runs (source_id, trigger_type, scope, status, started_at, finished_at, pages_fetched, listings_discovered, raw_snapshots_created, normalized_created)
SELECT s.id, 'manual', 'full', 'succeeded', NOW() - interval '3 hours', NOW() - interval '2 hours', 15, 33, 33, 33
FROM sources s WHERE s.code = 'immoscout24'
ON CONFLICT DO NOTHING;

INSERT INTO scrape_runs (source_id, trigger_type, scope, status, started_at, finished_at, pages_fetched, listings_discovered, raw_snapshots_created, normalized_created)
SELECT s.id, 'manual', 'full', 'succeeded', NOW() - interval '4 hours', NOW() - interval '3 hours', 3, 12, 12, 12
FROM sources s WHERE s.code = 'edikte'
ON CONFLICT DO NOTHING;

-- ── Raw listings (FK stubs) ──────────────────────────────────────────────────

DO $$
DECLARE
  wh_id INT; is_id INT; wh_run INT; is_run INT;
BEGIN
  SELECT id INTO wh_id FROM sources WHERE code = 'willhaben';
  SELECT id INTO is_id FROM sources WHERE code = 'immoscout24';
  SELECT id INTO wh_run FROM scrape_runs WHERE source_id = wh_id ORDER BY id DESC LIMIT 1;
  SELECT id INTO is_run FROM scrape_runs WHERE source_id = is_id ORDER BY id DESC LIMIT 1;

  FOR i IN 1..93 LOOP
    INSERT INTO raw_listings (source_id, first_scrape_run_id, last_scrape_run_id, source_listing_key, canonical_url, detail_url, extraction_status, raw_payload, content_sha256)
    VALUES (
      CASE WHEN i <= 60 THEN wh_id ELSE is_id END,
      CASE WHEN i <= 60 THEN wh_run ELSE is_run END,
      CASE WHEN i <= 60 THEN wh_run ELSE is_run END,
      'dev-' || i,
      'https://example.com/listing/' || i,
      'https://example.com/listing/' || i,
      'captured', '{}',
      lpad(encode(sha256(('dev-' || i)::bytea), 'hex'), 64, '0')
    )
    ON CONFLICT (source_id, source_listing_key, content_sha256) DO NOTHING;
  END LOOP;
END $$;

-- Edikte raw listings
DO $$
DECLARE
  ed_id INT; ed_run INT;
BEGIN
  SELECT id INTO ed_id FROM sources WHERE code = 'edikte';
  IF ed_id IS NULL THEN RETURN; END IF;
  SELECT id INTO ed_run FROM scrape_runs WHERE source_id = ed_id ORDER BY id DESC LIMIT 1;

  FOR i IN 1..12 LOOP
    INSERT INTO raw_listings (source_id, first_scrape_run_id, last_scrape_run_id, source_listing_key, canonical_url, detail_url, extraction_status, raw_payload, content_sha256)
    VALUES (
      ed_id, ed_run, ed_run,
      'edikte-dev-' || i,
      'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/listing/' || i,
      'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/listing/' || i,
      'captured', '{}',
      lpad(encode(sha256(('edikte-dev-' || i)::bytea), 'hex'), 64, '0')
    )
    ON CONFLICT (source_id, source_listing_key, content_sha256) DO NOTHING;
  END LOOP;
END $$;

-- ── Listings ─────────────────────────────────────────────────────────────────

DO $$
DECLARE
  wh_id INT; is_id INT; src INT; raw_lid INT; run_lid INT;
  d INT; dn TEXT; pr INT; ar NUMERIC; rm NUMERIC; sc NUMERIC;
  lat NUMERIC; lon NUMERIC; ttl TEXT; ppsqm NUMERIC; days INT;

  districts INT[] := ARRAY[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23];
  dnames TEXT[] := ARRAY['Innere Stadt','Leopoldstadt','Landstraße','Wieden','Margareten','Mariahilf','Neubau','Josefstadt','Alsergrund','Favoriten','Simmering','Meidling','Hietzing','Penzing','Rudolfsheim-Fünfhaus','Ottakring','Hernals','Währing','Döbling','Brigittenau','Floridsdorf','Donaustadt','Liesing'];
  dlats NUMERIC[] := ARRAY[48.2082,48.2167,48.1986,48.1920,48.1870,48.1950,48.2028,48.2100,48.2263,48.1625,48.1700,48.1750,48.1850,48.1950,48.1950,48.2100,48.2200,48.2300,48.2500,48.2400,48.2564,48.2300,48.1500];
  dlons NUMERIC[] := ARRAY[16.3738,16.3958,16.3948,16.3650,16.3556,16.3493,16.3493,16.3450,16.3560,16.3827,16.4300,16.3300,16.2800,16.2800,16.3200,16.3100,16.3200,16.3400,16.3500,16.3700,16.3988,16.4600,16.3000];
  dppsqm INT[] := ARRAY[11000,5200,5800,6200,4800,5500,6500,6800,6000,3800,3600,4200,7000,4500,4000,4100,4300,5500,7500,4000,3500,4200,4000];
  titles TEXT[] := ARRAY[
    'Sonnige Eigentumswohnung mit Balkon','Provisionsfrei! Renovierte Altbauwohnung',
    'Erstbezug nach Sanierung, Loggia','Anlage-Hit: Vermietete Wohnung',
    'Dachgeschoss-Maisonette mit Terrasse','Garconniere zur Kapitalanlage',
    'Helle Wohnung nahe U-Bahn','Stilvoller Altbau mit Parkettboden',
    'Neubau mit Freifläche und TG','Ruhige Hoflage, frisch saniert',
    'Familienfreundlich mit Grünblick','Penthouse mit Dachterrasse',
    'Kompakte Starterwohnung','Großzügige Wohnung mit Keller',
    'Lichtdurchflutete Eckwohnung','Wohnung mit Garten, ruhig',
    'Modern ausgestattet, sofort beziehbar','Investorentraum: hohe Rendite',
    'Charmanter Altbau-Juwel','Geräumig nahe Donaukanal',
    'Top-saniert mit Smart-Home','Barrierefrei im Erdgeschoss',
    'Exklusive Lage am Stadtpark','Preisreduziert! Sofort verfügbar',
    'Erstbezug: Designer-Küche inkl.'
  ];
  didx INT;
BEGIN
  SELECT id INTO wh_id FROM sources WHERE code = 'willhaben';
  SELECT id INTO is_id FROM sources WHERE code = 'immoscout24';

  FOR i IN 1..93 LOOP
    src := CASE WHEN i <= 60 THEN wh_id ELSE is_id END;
    SELECT rl.id INTO raw_lid FROM raw_listings rl WHERE rl.source_listing_key = 'dev-' || i AND rl.source_id = src LIMIT 1;
    SELECT sr.id INTO run_lid FROM scrape_runs sr WHERE sr.source_id = src ORDER BY id DESC LIMIT 1;

    didx := 1 + (floor(random() * 23))::int;
    d := districts[didx]; dn := dnames[didx];
    ar := 30 + floor(random() * 100);
    ppsqm := dppsqm[didx] * (0.75 + random() * 0.5);
    pr := (ar * ppsqm)::int;
    rm := CASE WHEN ar < 40 THEN 1 WHEN ar < 60 THEN 2 WHEN ar < 85 THEN 3 WHEN ar < 110 THEN 4 ELSE 5 END;
    sc := greatest(10, least(98, 55 + (random() - 0.5) * 60));
    lat := dlats[didx] + (random() - 0.5) * 0.01;
    lon := dlons[didx] + (random() - 0.5) * 0.015;
    ttl := titles[1 + (floor(random() * 25))::int] || ', ' || rm::int || ' Zimmer';
    days := floor(random() * 30)::int;

    INSERT INTO listings (
      listing_uid, source_id, source_listing_key, current_raw_listing_id, latest_scrape_run_id,
      canonical_url, operation_type, property_type, listing_status,
      title, district_no, district_name, postal_code, city, federal_state,
      latitude, longitude, geocode_precision, geocode_source,
      list_price_eur_cents, living_area_sqm, rooms,
      year_built, condition_category, has_elevator, has_balcony,
      normalized_payload, completeness_score, content_fingerprint, normalization_version,
      current_score, last_scored_at, first_seen_at, last_seen_at
    ) VALUES (
      gen_random_uuid(), src, 'dev-' || i, raw_lid, run_lid,
      'https://example.com/listing/' || i,
      'sale', 'apartment', 'active',
      ttl, d, dn, '1' || lpad(d::text, 2, '0') || '0', 'Wien', 'Wien',
      lat, lon, 'source_exact', 'source',
      pr * 100, ar, rm,
      1950 + floor(random() * 75)::int,
      CASE WHEN random() > 0.5 THEN 'renovated' ELSE 'good' END,
      random() > 0.4, random() > 0.5,
      '{}', 0.85, lpad(encode(sha256(('fp-' || i)::bytea), 'hex'), 64, '0'), 1,
      round(sc::numeric, 2), NOW(),
      NOW() - (days || ' days')::interval,
      NOW() - (least(days, 1) || ' days')::interval
    )
    ON CONFLICT (source_id, source_listing_key) DO UPDATE SET
      current_score = EXCLUDED.current_score,
      last_scored_at = NOW();
  END LOOP;
END $$;

-- Edikte listings (forced auctions)
DO $$
DECLARE
  ed_id INT; raw_lid INT; run_lid INT;
  d INT; dn TEXT; pr INT; ar NUMERIC; sc NUMERIC;
  lat NUMERIC; lon NUMERIC; ttl TEXT; days INT;

  -- Subset of districts where forced auctions typically occur
  districts INT[] := ARRAY[2,10,11,16,20,21,22,23,3,5,12,14];
  dnames TEXT[] := ARRAY['Leopoldstadt','Favoriten','Simmering','Ottakring','Brigittenau','Floridsdorf','Donaustadt','Liesing','Landstraße','Margareten','Meidling','Penzing'];
  dlats NUMERIC[] := ARRAY[48.2167,48.1625,48.1700,48.2100,48.2400,48.2564,48.2300,48.1500,48.1986,48.1870,48.1750,48.1950];
  dlons NUMERIC[] := ARRAY[16.3958,16.3827,16.4300,16.3100,16.3700,16.3988,16.4600,16.3000,16.3948,16.3556,16.3300,16.2800];
  ptypes TEXT[] := ARRAY['apartment','house','apartment','apartment','house','apartment','house','apartment','apartment','house','apartment','house'];
  courts TEXT[] := ARRAY['BG Leopoldstadt','BG Favoriten','BG Simmering','BG Hernals','BG Floridsdorf','BG Floridsdorf','BG Donaustadt','BG Liesing','BG Innere Stadt','BG Margareten','BG Meidling','BG Hietzing'];
  didx INT;
BEGIN
  SELECT id INTO ed_id FROM sources WHERE code = 'edikte';
  IF ed_id IS NULL THEN RETURN; END IF;

  FOR i IN 1..12 LOOP
    SELECT rl.id INTO raw_lid FROM raw_listings rl WHERE rl.source_listing_key = 'edikte-dev-' || i AND rl.source_id = ed_id LIMIT 1;
    SELECT sr.id INTO run_lid FROM scrape_runs sr WHERE sr.source_id = ed_id ORDER BY id DESC LIMIT 1;

    didx := ((i - 1) % 12) + 1;
    d := districts[didx]; dn := dnames[didx];
    ar := 40 + floor(random() * 120);
    -- Forced auctions: appraised value, typically discounted
    pr := (ar * (2500 + floor(random() * 3000)))::int;
    sc := greatest(60, least(98, 75 + (random() - 0.5) * 30));
    lat := dlats[didx] + (random() - 0.5) * 0.008;
    lon := dlons[didx] + (random() - 0.5) * 0.012;
    ttl := 'Zwangsversteigerung ' || courts[didx] || ' – ' || CASE WHEN ptypes[didx] = 'house' THEN 'Einfamilienhaus' ELSE 'Eigentumswohnung' END || ', ' || dn;
    days := floor(random() * 14)::int;

    INSERT INTO listings (
      listing_uid, source_id, source_listing_key, current_raw_listing_id, latest_scrape_run_id,
      canonical_url, operation_type, property_type, listing_status,
      title, district_no, district_name, postal_code, city, federal_state,
      latitude, longitude, geocode_precision, geocode_source,
      list_price_eur_cents, living_area_sqm, rooms,
      year_built, condition_category,
      normalized_payload, completeness_score, content_fingerprint, normalization_version,
      current_score, last_scored_at, first_seen_at, last_seen_at
    ) VALUES (
      gen_random_uuid(), ed_id, 'edikte-dev-' || i, raw_lid, run_lid,
      'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/listing/' || i,
      'sale', ptypes[didx], 'active',
      ttl, d, dn, '1' || lpad(d::text, 2, '0') || '0', 'Wien', 'Wien',
      lat, lon, 'source_exact', 'source',
      pr * 100, ar, CASE WHEN ar < 50 THEN 2 WHEN ar < 80 THEN 3 WHEN ar < 110 THEN 4 ELSE 5 END,
      1960 + floor(random() * 50)::int,
      CASE WHEN random() > 0.6 THEN 'renovation_needed' ELSE 'good' END,
      '{}', 0.70, lpad(encode(sha256(('fp-edikte-' || i)::bytea), 'hex'), 64, '0'), 1,
      round(sc::numeric, 2), NOW(),
      NOW() - (days || ' days')::interval,
      NOW() - (least(days, 1) || ' days')::interval
    )
    ON CONFLICT (source_id, source_listing_key) DO UPDATE SET
      current_score = EXCLUDED.current_score,
      last_scored_at = NOW();
  END LOOP;
END $$;

-- Add price drops to ~15 listings
UPDATE listings SET
  last_price_change_at = NOW() - (floor(random() * 5 + 1)::int || ' days')::interval
WHERE source_listing_key LIKE 'dev-%'
  AND id IN (SELECT id FROM listings WHERE source_listing_key LIKE 'dev-%' ORDER BY random() LIMIT 15);

-- ── Listing versions (needed for scores FK) ──────────────────────────────────

INSERT INTO listing_versions (listing_id, raw_listing_id, version_no, version_reason, content_fingerprint, listing_status, list_price_eur_cents, living_area_sqm, price_per_sqm_eur, normalized_snapshot)
SELECT l.id, l.current_raw_listing_id, 1, 'first_seen', l.content_fingerprint, l.listing_status,
       l.list_price_eur_cents, l.living_area_sqm, l.price_per_sqm_eur, '{}'
FROM listings l
WHERE (l.source_listing_key LIKE 'dev-%' OR l.source_listing_key LIKE 'edikte-dev-%')
  AND NOT EXISTS (SELECT 1 FROM listing_versions lv WHERE lv.listing_id = l.id)
ON CONFLICT DO NOTHING;

-- ── Source health ────────────────────────────────────────────────────────────

UPDATE sources SET
  health_status = 'healthy',
  last_successful_run_at = NOW() - interval '30 minutes'
WHERE is_active = true;

-- ── Market baselines ─────────────────────────────────────────────────────────

INSERT INTO market_baselines (
  city, operation_type, property_type, district_no, area_bucket, room_bucket, source_scope,
  median_ppsqm_eur, p25_ppsqm_eur, p75_ppsqm_eur, sample_size, baseline_date
)
SELECT 'Wien', 'sale', 'apartment', d.district_no, 'all', 'all', 'all_sources',
  d.avg_ppsqm, round(d.avg_ppsqm * 0.82), round(d.avg_ppsqm * 1.18),
  d.cnt, CURRENT_DATE
FROM (
  SELECT district_no, round(avg(price_per_sqm_eur)) as avg_ppsqm, count(*) as cnt
  FROM listings WHERE district_no IS NOT NULL AND price_per_sqm_eur IS NOT NULL
  GROUP BY district_no
) d
ON CONFLICT DO NOTHING;

-- ── User filters (denormalized columns) ──────────────────────────────────────

INSERT INTO user_filters (user_id, name, filter_kind, is_active, operation_type, property_types, districts, max_price_eur_cents, min_area_sqm, min_rooms, min_score, excluded_keywords, sort_by, alert_frequency, criteria_json)
SELECT u.id, 'Vienna Value Apartments', 'alert', true,
  'sale', ARRAY['apartment'], ARRAY[2,3,5,7,9]::smallint[],
  35000000, 50, 2, 70, ARRAY['baurecht'], 'score_desc', 'instant',
  '{"operationType":"sale","propertyTypes":["apartment"],"districts":[2,3,5,7,9],"maxPriceEur":350000,"minAreaSqm":50,"minRooms":2,"minScore":70}'
FROM app_users u WHERE u.email = 'owner@example.com'
  AND NOT EXISTS (SELECT 1 FROM user_filters f WHERE f.user_id = u.id AND f.name = 'Vienna Value Apartments');

INSERT INTO user_filters (user_id, name, filter_kind, is_active, operation_type, property_types, max_price_eur_cents, min_area_sqm, min_rooms, sort_by, alert_frequency, criteria_json)
SELECT u.id, 'Large Family Apartments', 'alert', true,
  'sale', ARRAY['apartment'],
  50000000, 80, 3, 'price_asc', 'daily_digest',
  '{"operationType":"sale","propertyTypes":["apartment"],"maxPriceEur":500000,"minAreaSqm":80,"minRooms":3}'
FROM app_users u WHERE u.email = 'owner@example.com'
  AND NOT EXISTS (SELECT 1 FROM user_filters f WHERE f.user_id = u.id AND f.name = 'Large Family Apartments');

INSERT INTO user_filters (user_id, name, filter_kind, is_active, operation_type, property_types, districts, max_price_eur_cents, min_area_sqm, min_score, sort_by, alert_frequency, criteria_json)
SELECT u.id, 'Sub-4000 EUR/sqm Deals', 'alert', true,
  'sale', ARRAY['apartment','house'], ARRAY[2,10,11,20,21,22]::smallint[],
  25000000, 40, 60, 'score_desc', 'hourly_digest',
  '{"operationType":"sale","propertyTypes":["apartment","house"],"districts":[2,10,11,20,21,22],"maxPriceEur":250000,"minAreaSqm":40,"minScore":60}'
FROM app_users u WHERE u.email = 'owner@example.com'
  AND NOT EXISTS (SELECT 1 FROM user_filters f WHERE f.user_id = u.id AND f.name = 'Sub-4000 EUR/sqm Deals');

-- ── Listing scores ───────────────────────────────────────────────────────────

INSERT INTO listing_scores (
  listing_id, listing_version_id, score_version, overall_score,
  district_price_score, undervaluation_score, keyword_signal_score,
  time_on_market_score, confidence_score, location_score,
  district_baseline_ppsqm_eur, bucket_baseline_ppsqm_eur,
  discount_to_district_pct, discount_to_bucket_pct,
  matched_positive_keywords, matched_negative_keywords, explanation
)
SELECT
  l.id, lv.id, 1, l.current_score,
  round(greatest(20, least(100, l.current_score::double precision + (random() - 0.5) * 20))::numeric, 2),
  round(greatest(20, least(100, l.current_score::double precision + (random() - 0.5) * 25))::numeric, 2),
  round(greatest(10, least(100, 50 + (random() - 0.5) * 40))::numeric, 2),
  round(greatest(30, least(100, 70 + (random() - 0.5) * 30))::numeric, 2),
  round(greatest(40, least(100, 75 + (random() - 0.5) * 20))::numeric, 2),
  round(greatest(20, least(100, 60 + (random() - 0.5) * 30))::numeric, 2),
  COALESCE(b.median_ppsqm_eur, 5000),
  round((COALESCE(b.median_ppsqm_eur, 5000) * (0.9 + random() * 0.2))::numeric, 2),
  round(CASE WHEN l.price_per_sqm_eur IS NOT NULL AND b.median_ppsqm_eur IS NOT NULL AND b.median_ppsqm_eur > 0
    THEN ((l.price_per_sqm_eur - b.median_ppsqm_eur) / b.median_ppsqm_eur)
    ELSE 0::numeric END, 4),
  0,
  CASE WHEN random() > 0.6 THEN ARRAY['provisionsfrei'] ELSE ARRAY[]::text[] END,
  ARRAY[]::text[],
  '{}'
FROM listings l
JOIN listing_versions lv ON lv.listing_id = l.id AND lv.version_no = 1
LEFT JOIN LATERAL (
  SELECT median_ppsqm_eur FROM market_baselines mb
  WHERE mb.district_no = l.district_no AND mb.operation_type = 'sale'
  ORDER BY mb.baseline_date DESC LIMIT 1
) b ON true
WHERE (l.source_listing_key LIKE 'dev-%' OR l.source_listing_key LIKE 'edikte-dev-%')
ON CONFLICT (listing_version_id, score_version) DO NOTHING;

-- ── Summary ──────────────────────────────────────────────────────────────────

DO $$
DECLARE lc INT; fc INT; sc INT; bc INT;
BEGIN
  SELECT count(*) INTO lc FROM listings;
  SELECT count(*) INTO fc FROM user_filters;
  SELECT count(*) INTO sc FROM sources WHERE is_active;
  SELECT count(*) INTO bc FROM market_baselines;
  RAISE NOTICE 'Seed complete: % listings, % filters, % active sources, % baselines', lc, fc, sc, bc;
END $$;

COMMIT;
