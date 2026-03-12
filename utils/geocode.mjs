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
 * Returns { latitude, longitude } or null.
 */
export async function geocodeAddress({
  address_line,
  district,
  subdistrict,
  province,
  postal_code,
}) {
  const parts = [address_line, subdistrict, district, province, postal_code].filter(Boolean);
  if (!parts.length) return null;

  const q = `${parts.join(', ')}, Thailand`;
  await delay(1100);
  return nominatimSearch(q);
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
