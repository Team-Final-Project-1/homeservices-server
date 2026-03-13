import pool from './db.mjs';
import { geocodeAddress } from './geocode.mjs';

/**
 * Use client-supplied lat/lng when valid; otherwise geocode.
 */
export async function resolveAddressCoords(addressPayload) {
  const lat = addressPayload?.latitude;
  const lng = addressPayload?.longitude;
  if (
    lat != null &&
    lng != null &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng))
  ) {
    return { latitude: Number(lat), longitude: Number(lng) };
  }
  return geocodeAddress({
    address_line: addressPayload?.address_line,
    district: addressPayload?.district ?? undefined,
    subdistrict: addressPayload?.subdistrict ?? undefined,
    province: addressPayload?.province ?? undefined,
    postal_code: addressPayload?.postal_code ?? undefined,
  });
}

/**
 * Same user + same address fields → reuse row, no duplicate INSERT.
 */
export async function findOrInsertAddress(userId, addressPayload) {
  const line = String(addressPayload?.address_line || '').trim();
  if (!line) return null;

  const coords = await resolveAddressCoords(addressPayload);
  const lat = coords?.latitude ?? null;
  const lng = coords?.longitude ?? null;

  const district = addressPayload?.district != null ? String(addressPayload.district).trim() : '';
  const subdistrict = addressPayload?.subdistrict != null ? String(addressPayload.subdistrict).trim() : '';
  const province = addressPayload?.province != null ? String(addressPayload.province).trim() : '';
  const postal = addressPayload?.postal_code != null ? String(addressPayload.postal_code).trim() : '';

  const existing = await pool.query(
    `SELECT id, latitude, longitude FROM addresses
     WHERE user_id = $1
       AND trim(address_line) = $2
       AND trim(coalesce(district, '')) = $3
       AND trim(coalesce(subdistrict, '')) = $4
       AND trim(coalesce(province, '')) = $5
       AND trim(coalesce(postal_code, '')) = $6
     LIMIT 1`,
    [userId, line, district, subdistrict, province, postal]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (
      lat != null &&
      lng != null &&
      (row.latitude == null ||
        row.longitude == null ||
        Number(row.latitude) !== lat ||
        Number(row.longitude) !== lng)
    ) {
      await pool.query(
        `UPDATE addresses SET latitude = $1, longitude = $2 WHERE id = $3`,
        [lat, lng, row.id]
      );
    }
    return row.id;
  }

  const ins = await pool.query(
    `INSERT INTO addresses (user_id, address_line, district, subdistrict, province, postal_code, latitude, longitude)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      userId,
      addressPayload.address_line,
      addressPayload.district ?? null,
      addressPayload.subdistrict ?? null,
      addressPayload.province ?? null,
      addressPayload.postal_code ?? null,
      lat,
      lng,
    ]
  );
  return ins.rows[0].id;
}
