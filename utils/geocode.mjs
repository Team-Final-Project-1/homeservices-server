import https from 'https';

/**
 * Server-side geocoding aligned with the Leaflet/OSM stack.
 * Uses Nominatim (OpenStreetMap) — same data source as Leaflet map tiles
 * and plugins like leaflet-geosearch / Leaflet Control Geocoder.
 *
 * Nominatim usage policy: identify your app via User-Agent; be gentle on rate limits.
 */
const NOMINATIM_HOST = 'nominatim.openstreetmap.org';
const USER_AGENT =
  process.env.NOMINATIM_USER_AGENT ||
  'homeservice-server/1.0 (geocode; contact via app)';

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Geocode to latitude/longitude for use with Leaflet (lat/lng).
 * Tries multiple query strategies for better Thai location coverage.
 * Returns { latitude, longitude } or null.
 */
export async function geocodeAddress({
  address_line,
  district,
  subdistrict,
  province,
  postal_code,
}) {
  if (!province && !district && !subdistrict && !postal_code) return null;

  // Strategy 1: Try structured search with Thai administrative prefixes
  const queries = buildSearchQueries({ subdistrict, district, province, postal_code });
  
  for (const query of queries) {
    await delay(1100);
    const result = await nominatimSearch(query);
    if (result) return result;
  }

  return null;
}

/**
 * Build search query variants ordered by specificity.
 * Thai locations may be stored with or without prefixes (ตำบล, อำเภอ, จังหวัด).
 * We try without prefixes first (more common in OSM), then with prefixes as fallback.
 */
function buildSearchQueries({ subdistrict, district, province, postal_code }) {
  const queries = [];

  // Most specific: subdistrict + district + province (without prefix first - more common)
  if (subdistrict && district && province) {
    queries.push(`${subdistrict}, ${district}, ${province}, Thailand`);
    queries.push(`ตำบล${subdistrict}, อำเภอ${district}, จังหวัด${province}, Thailand`);
  }

  // Less specific: district + province
  if (district && province) {
    queries.push(`${district}, ${province}, Thailand`);
    queries.push(`อำเภอ${district}, จังหวัด${province}, Thailand`);
  }

  // Fallback: province only (ensures at least province-level centering)
  if (province) {
    queries.push(`${province}, Thailand`);
  }

  return queries;
}

function nominatimSearch(query) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    limit: '5',
    countrycodes: 'th',
    addressdetails: '1',
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: NOMINATIM_HOST,
        path: `/search?${params.toString()}`,
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'application/json',
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (!Array.isArray(data) || !data.length) {
              resolve(null);
              return;
            }
            const first = data[0];
            const lat = Number(first.lat);
            const lon = Number(first.lon);
            if (Number.isNaN(lat) || Number.isNaN(lon)) {
              resolve(null);
              return;
            }
            resolve({ latitude: lat, longitude: lon });
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(8000, () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}
