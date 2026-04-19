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
  if (!address_line && !province && !district && !subdistrict && !postal_code)
    return null;

  // Strategy 1: Try structured search with Thai administrative prefixes
  const queries = buildSearchQueries({
    address_line,
    subdistrict,
    district,
    province,
    postal_code,
  });
  
  for (const query of queries) {
    await delay(1100);
    const result = await nominatimSearch(query);
    if (result) return result;
  }

  return null;
}

/**
 * Reverse geocode map coordinates to address fields.
 * Returns null when not found.
 */
export async function reverseGeocodeCoordinates(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  await delay(300);
  return nominatimReverse(latitude, longitude);
}

/**
 * Build search query variants ordered by specificity.
 * Thai locations may be stored with or without prefixes (ตำบล, อำเภอ, จังหวัด).
 * We try without prefixes first (more common in OSM), then with prefixes as fallback.
 */
function buildSearchQueries({
  address_line,
  subdistrict,
  district,
  province,
  postal_code,
}) {
  const queries = [];
  const baseParts = [address_line, subdistrict, district, province, postal_code]
    .map((p) => (p ?? '').trim())
    .filter(Boolean);

  if (baseParts.length > 0) {
    queries.push(`${baseParts.join(', ')}, Thailand`);
  }

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

function nominatimReverse(latitude, longitude) {
  const params = new URLSearchParams({
    lat: String(latitude),
    lon: String(longitude),
    format: 'jsonv2',
    addressdetails: '1',
    zoom: '18',
  });

  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: NOMINATIM_HOST,
        path: `/reverse?${params.toString()}`,
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
            resolve(normalizeReverseAddressResult(data));
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

function stripThaiAdminPrefix(value, pattern) {
  return String(value ?? '').trim().replace(pattern, '').trim();
}

function normalizeReverseAddressResult(data) {
  const displayName =
    typeof data?.display_name === 'string' ? data.display_name.trim() : '';
  const a = data?.address && typeof data.address === 'object' ? data.address : {};
  const countryCode = String(a.country_code || '').toLowerCase();

  const streetAddress = [a.house_number, a.road, a.neighbourhood]
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .join(' ')
    .trim();
  const addressLine = streetAddress || displayName || null;

  if (countryCode === 'th') {
    const city = String(a.city || '');
    const state = String(a.state || '');
    const bangkokRe = /กรุงเทพ|bangkok/i;
    const isBangkok =
      bangkokRe.test(city) ||
      bangkokRe.test(state) ||
      displayName.includes('กรุงเทพมหานคร');

    if (isBangkok) {
      let province = '';
      if (bangkokRe.test(city)) province = city.trim();
      else if (bangkokRe.test(state)) province = state.trim();
      else province = 'กรุงเทพมหานคร';

      let district = stripThaiAdminPrefix(a.city_district || '', /^เขต\s*/);
      if (!district) {
        const suburbForKhet = String(a.suburb || '').trim();
        if (/^เขต/.test(suburbForKhet)) {
          district = stripThaiAdminPrefix(suburbForKhet, /^เขต\s*/);
        }
      }
      if (!district) {
        const m = displayName.match(/เขต([^,，]+)/);
        if (m) district = m[1].trim();
      }

      const suburbRaw = String(a.suburb || '').trim();
      const suburbIsKhet = /^เขต/.test(suburbRaw);
      let subdistrict = '';
      if (suburbRaw && !suburbIsKhet) {
        subdistrict = stripThaiAdminPrefix(suburbRaw, /^แขวง\s*/);
      }
      if (!subdistrict) {
        const fallbackSub = String(a.quarter || a.neighbourhood || '').trim();
        subdistrict = stripThaiAdminPrefix(fallbackSub, /^แขวง\s*/);
      }
      if (!subdistrict) {
        const m = displayName.match(/แขวง([^,，]+)/);
        if (m) subdistrict = m[1].trim();
      }

      return {
        address_line: addressLine,
        subdistrict: subdistrict || null,
        district: district || null,
        province: province || null,
        postal_code: String(a.postcode || '').trim() || null,
        display_name: displayName || null,
      };
    }

    const provinceRaw = String(a.province || a.state || '').trim();
    const districtRaw = String(
      a.county || a.city_district || a.district || a.city || a.town || ''
    ).trim();
    const subRaw = String(
      a.municipality || a.suburb || a.quarter || a.village || ''
    ).trim();

    return {
      address_line: addressLine,
      subdistrict: stripThaiAdminPrefix(subRaw, /^แขวง\s*|^ตำบล\s*/) || null,
      district: stripThaiAdminPrefix(districtRaw, /^อำเภอ\s*|^เขต\s*/) || null,
      province: stripThaiAdminPrefix(provinceRaw, /^จังหวัด\s*/) || null,
      postal_code: String(a.postcode || '').trim() || null,
      display_name: displayName || null,
    };
  }

  return {
    address_line: addressLine,
    subdistrict: String(a.suburb || a.quarter || '').trim() || null,
    district: String(a.city || a.town || a.county || '').trim() || null,
    province: String(a.state || '').trim() || null,
    postal_code: String(a.postcode || '').trim() || null,
    display_name: displayName || null,
  };
}
