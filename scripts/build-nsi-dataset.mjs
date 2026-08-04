/**
 * build-nsi-dataset.mjs — refreshes public/data/nsi_orleans.json
 *
 * Fetches the FEMA/USACE National Structure Inventory for Orleans Parish
 * (FIPS 22071) and trims it to just the fields DamagePanel/NSIService use,
 * filtered to within NSI_RADIUS_MI of any preset location in Controls.js.
 *
 * The NSI API has no working bbox filter (returns empty/500/wrong-region
 * results in testing) and no documented spec, so this fetches the full
 * parish (~120MB) and filters client-side — a one-time offline step, not
 * something the app does at runtime.
 *
 * Usage: node scripts/build-nsi-dataset.mjs
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const FIPS = '22071'; // Orleans Parish, LA
const NSI_URL = `https://nsi.sec.usace.army.mil/nsiapi/structures?fips=${FIPS}`;
const OUTPUT_PATH = join(__dirname, '../public/data/nsi_orleans.json');
const RADIUS_MI = 1.0;

// Keep in sync with LOCATIONS in src/ui/Controls.js
const LOCATIONS = [
  [-90.0644, 29.9584], [-90.1209, 29.9401], [-90.0715, 29.9511],
  [-89.9935, 29.9649], [-90.0267, 29.9701], [-90.0125, 29.9570],
  [-90.0055, 29.9631], [-90.0942, 29.9282], [-90.0800, 30.0250],
  [-90.0690, 29.9530], [-90.0812, 29.9511],
];

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371.0;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlmb = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dlmb / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearAnyPreset(lat, lng, radiusKm) {
  for (const [llng, llat] of LOCATIONS) {
    if (haversineKm(lat, lng, llat, llng) <= radiusKm) return true;
  }
  return false;
}

async function main() {
  console.log(`Fetching NSI structures for FIPS ${FIPS} (this is ~120MB, may take a minute)...`);
  const res = await fetch(NSI_URL);
  if (!res.ok) throw new Error(`NSI fetch failed: HTTP ${res.status}`);
  const data = await res.json();

  const radiusKm = RADIUS_MI * 1.60934;
  const trimmed = [];

  for (const f of data.features) {
    const [lng, lat] = f.geometry.coordinates;
    if (!nearAnyPreset(lat, lng, radiusKm)) continue;

    const p = f.properties;
    const foundHt = p.found_ht != null && p.found_ht >= 0 ? p.found_ht : null;
    const valStruct = p.val_struct > 0 ? Math.round(p.val_struct) : null;
    const valCont = p.val_cont > 0 ? Math.round(p.val_cont) : null;

    trimmed.push({
      lng: Math.round(lng * 1e6) / 1e6,
      lat: Math.round(lat * 1e6) / 1e6,
      occtype: p.occtype ?? null,
      found_ht: foundHt,
      val_struct: valStruct,
      val_cont: valCont,
      sqft: p.sqft ?? null,
    });
  }

  const out = JSON.stringify(trimmed);
  writeFileSync(OUTPUT_PATH, out);
  console.log(`Wrote ${trimmed.length} buildings, ${(out.length / 1e6).toFixed(2)} MB → ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
