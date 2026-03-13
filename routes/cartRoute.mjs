import express from 'express';
import pool from '../utils/db.mjs';
import { findOrInsertAddress } from '../utils/addressHelper.mjs';

const router = express.Router();

/**
 * GET /api/cart?authUserId=uuid
 * Returns all cart items for the user with service name, image, address, and details.
 */
router.get('/', async (req, res) => {
  try {
    const authUserId = typeof req.query.authUserId === 'string' ? req.query.authUserId.trim() : '';
    if (!authUserId) {
      return res.status(400).json({ error: 'authUserId is required.' });
    }
    const userRes = await pool.query('SELECT id FROM users WHERE auth_user_id = $1', [authUserId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].id;

    const cartRes = await pool.query(
      `SELECT
        ci.id AS cart_item_id,
        ci.service_id,
        ci.address_id,
        ci.cart_appointment_date AS appointment_date,
        ci.cart_appointment_time AS appointment_time,
        ci.cart_remark AS remark,
        s.name AS service_name,
        s.image AS service_image,
        a.address_line,
        a.district,
        a.subdistrict,
        a.province,
        a.postal_code
       FROM cart_items ci
       JOIN services s ON s.id = ci.service_id
       LEFT JOIN addresses a ON a.id = ci.address_id
       WHERE ci.user_id = $1
       ORDER BY ci.created_at DESC`,
      [userId]
    );

    const cartItems = [];
    for (const row of cartRes.rows) {
      const detailsRes = await pool.query(
        `SELECT
          cid.id,
          cid.service_item_id,
          cid.quantity,
          cid.price_per_unit,
          si.name AS item_name,
          si.unit
         FROM cart_item_details cid
         JOIN service_items si ON si.id = cid.service_item_id
         WHERE cid.cart_item_id = $1
         ORDER BY cid.id`,
        [row.cart_item_id]
      );
      const total = detailsRes.rows.reduce(
        (sum, d) => sum + Number(d.price_per_unit) * Number(d.quantity),
        0
      );
      cartItems.push({
        id: row.cart_item_id,
        serviceId: row.service_id,
        serviceName: row.service_name,
        serviceImage: row.service_image || null,
        addressId: row.address_id,
        addressLine: row.address_line,
        district: row.district,
        subdistrict: row.subdistrict,
        province: row.province,
        postalCode: row.postal_code,
        appointmentDate: row.appointment_date,
        appointmentTime: row.appointment_time,
        remark: row.remark,
        details: detailsRes.rows.map((d) => ({
          id: d.id,
          serviceItemId: d.service_item_id,
          name: d.item_name,
          unit: d.unit,
          quantity: d.quantity,
          pricePerUnit: Number(d.price_per_unit),
        })),
        total,
      });
    }

    res.status(200).json({ cartItems });
  } catch (err) {
    console.error('Get cart error:', err);
    res.status(500).json({ error: 'Failed to get cart.' });
  }
});

/**
 * POST /api/cart
 * Create a new cart item (add to cart).
 * Body: {
 *   authUserId, serviceId, addressId?, address?,
 *   appointmentDate, appointmentTime, remark?,
 *   items: [{ serviceItemId, quantity, pricePerUnit }]
 * }
 */
router.post('/', express.json(), async (req, res) => {
  try {
    const {
      authUserId,
      serviceId,
      addressId: providedAddressId,
      address: addressPayload,
      appointmentDate,
      appointmentTime,
      remark,
      items,
    } = req.body;

    if (!authUserId || !serviceId || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        error: 'authUserId, serviceId, and items (array) are required.',
      });
    }

    const userRes = await pool.query('SELECT id FROM users WHERE auth_user_id = $1', [authUserId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].id;

    let addressId = providedAddressId != null ? Number(providedAddressId) : null;
    if (!addressId && addressPayload?.address_line) {
      addressId = await findOrInsertAddress(userId, addressPayload);
    }
    if (!addressId) {
      return res.status(400).json({
        error: 'Either addressId or address (with address_line) is required.',
      });
    }

    const cartRes = await pool.query(
      `INSERT INTO cart_items (user_id, service_id, address_id, cart_appointment_date, cart_appointment_time, cart_remark)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        userId,
        serviceId,
        addressId,
        appointmentDate || null,
        appointmentTime || null,
        remark ?? null,
      ]
    );
    const cartItemId = cartRes.rows[0].id;

    for (const it of items) {
      await pool.query(
        `INSERT INTO cart_item_details (cart_item_id, service_item_id, quantity, price_per_unit)
         VALUES ($1, $2, $3, $4)`,
        [cartItemId, it.serviceItemId, it.quantity, it.pricePerUnit]
      );
    }

    res.status(201).json({ cartItemId, addressId });
  } catch (err) {
    console.error('Add to cart error:', err);
    res.status(500).json({ error: 'Failed to add to cart.' });
  }
});

/**
 * PUT /api/cart/:id
 * Update an existing cart item (no new row).
 */
router.put('/:id', express.json(), async (req, res) => {
  try {
    const cartItemId = Number(req.params.id);
    if (!Number.isFinite(cartItemId)) {
      return res.status(400).json({ error: 'Invalid cart item id.' });
    }
    const {
      authUserId,
      addressId: providedAddressId,
      address: addressPayload,
      appointmentDate,
      appointmentTime,
      remark,
      items,
    } = req.body;

    if (!authUserId) {
      return res.status(400).json({ error: 'authUserId is required.' });
    }

    const userRes = await pool.query('SELECT id FROM users WHERE auth_user_id = $1', [authUserId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].id;

    const existing = await pool.query(
      'SELECT id FROM cart_items WHERE id = $1 AND user_id = $2',
      [cartItemId, userId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Cart item not found.' });
    }

    let addressId = providedAddressId != null ? Number(providedAddressId) : null;
    if (!addressId && addressPayload?.address_line) {
      addressId = await findOrInsertAddress(userId, addressPayload);
    }
    if (!addressId) {
      return res.status(400).json({
        error: 'Either addressId or address (with address_line) is required.',
      });
    }

    await pool.query(
      `UPDATE cart_items
       SET address_id = $1, cart_appointment_date = $2, cart_appointment_time = $3, cart_remark = $4, updated_at = now()
       WHERE id = $5 AND user_id = $6`,
      [addressId, appointmentDate || null, appointmentTime || null, remark ?? null, cartItemId, userId]
    );

    if (Array.isArray(items) && items.length > 0) {
      await pool.query('DELETE FROM cart_item_details WHERE cart_item_id = $1', [cartItemId]);
      for (const it of items) {
        await pool.query(
          `INSERT INTO cart_item_details (cart_item_id, service_item_id, quantity, price_per_unit)
           VALUES ($1, $2, $3, $4)`,
          [cartItemId, it.serviceItemId, it.quantity, it.pricePerUnit]
        );
      }
    }

    res.status(200).json({ ok: true, cartItemId });
  } catch (err) {
    console.error('Update cart error:', err);
    res.status(500).json({ error: 'Failed to update cart.' });
  }
});

/**
 * DELETE /api/cart/:id?authUserId=uuid
 * Delete a cart item and its details.
 */
router.delete('/:id', async (req, res) => {
  try {
    const cartItemId = Number(req.params.id);
    const authUserId = typeof req.query.authUserId === 'string' ? req.query.authUserId.trim() : '';
    if (!Number.isFinite(cartItemId) || !authUserId) {
      return res.status(400).json({ error: 'Invalid id or authUserId required.' });
    }

    const userRes = await pool.query('SELECT id FROM users WHERE auth_user_id = $1', [authUserId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }
    const userId = userRes.rows[0].id;

    await pool.query('DELETE FROM cart_item_details WHERE cart_item_id = $1', [cartItemId]);
    const del = await pool.query('DELETE FROM cart_items WHERE id = $1 AND user_id = $2 RETURNING id', [
      cartItemId,
      userId,
    ]);
    if (del.rows.length === 0) {
      return res.status(404).json({ error: 'Cart item not found.' });
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Delete cart item error:', err);
    res.status(500).json({ error: 'Failed to delete cart item.' });
  }
});

export default router;
