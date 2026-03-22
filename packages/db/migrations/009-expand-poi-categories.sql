-- Migration 009: Expand POI categories
-- Split transit into ubahn/tram/bus/taxi, add fire_station/supermarket/hospital/doctor

-- Drop old constraint and add expanded category set
ALTER TABLE pois DROP CONSTRAINT IF EXISTS pois_category_check;
ALTER TABLE pois ADD CONSTRAINT pois_category_check
  CHECK (category IN (
    'ubahn','tram','bus','taxi',
    'park','school',
    'police','fire_station',
    'supermarket',
    'hospital','doctor'
  ));

-- Delete old undifferentiated transit data (will be re-imported with proper classification)
DELETE FROM pois WHERE category = 'transit';

-- Add composite index for district-level category queries
CREATE INDEX IF NOT EXISTS idx_pois_category_district ON pois (category, district_no);
