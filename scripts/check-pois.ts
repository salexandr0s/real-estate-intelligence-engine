import { query } from '@rei/db';

async function main() {
  const pois = await query(
    'SELECT category, COUNT(*)::int AS count FROM pois GROUP BY category ORDER BY category',
  );
  console.log('=== pois table ===');
  if (pois.length === 0) console.log('(empty)');
  else console.table(pois);

  const lp = await query(
    'SELECT category, COUNT(*)::int AS count FROM listing_pois GROUP BY category ORDER BY category',
  );
  console.log('\n=== listing_pois table ===');
  if (lp.length === 0) console.log('(empty)');
  else console.table(lp);

  const listings = await query(
    'SELECT COUNT(*)::int AS total FROM listings WHERE listing_status = $$active$$',
  );
  console.log('\ntotal active listings:', listings[0]?.total ?? 0);

  const geocoded = await query(
    'SELECT COUNT(*)::int AS total FROM listings WHERE latitude IS NOT NULL AND listing_status = $$active$$',
  );
  console.log('geocoded active listings:', geocoded[0]?.total ?? 0);

  process.exit(0);
}
main();
