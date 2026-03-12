import express from 'express';
import { geocodeAddress } from '../utils/geocode.mjs';

const router = express.Router();

function q(req, name) {
  const v = req.query[name];
  return typeof v === 'string' ? v.trim() : '';
}

router.get('/preview', async (req, res) => {
  try {
    const address_line = q(req, 'address_line');
    const district = q(req, 'district');
    const subdistrict = q(req, 'subdistrict');
    const province = q(req, 'province');
    const postal_code = q(req, 'postal_code');

    if (!address_line && !province) {
      return res.status(400).json({ error: 'Provide address_line or province.' });
    }

    const coords = await geocodeAddress({
      address_line: address_line || undefined,
      district: district || undefined,
      subdistrict: subdistrict || undefined,
      province: province || undefined,
      postal_code: postal_code || undefined,
    });

    if (!coords) {
      return res.status(200).json({ latitude: null, longitude: null });
    }
    res.status(200).json({
      latitude: coords.latitude,
      longitude: coords.longitude,
    });
  } catch (err) {
    console.error('Geocode preview error:', err);
    res.status(500).json({ error: 'Geocode failed.' });
  }
});

export default router;
