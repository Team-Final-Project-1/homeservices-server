import express from 'express';
import pool from '../utils/db.mjs';

const router = express.Router();

async function resolveInternalUserId(userIdParam) {
  const s = String(userIdParam ?? '');
  const isNumeric = /^[0-9]+$/.test(s);
  const isUUID =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  if (!isNumeric && !isUUID) return null;
  if (isNumeric) return parseInt(s, 10);
  const { rows } = await pool.query('SELECT id FROM users WHERE auth_user_id = $1::uuid', [s]);
  return rows[0]?.id ?? null;
}

/**
 * POST /api/reviews
 * body: { userId, orderId, rating, comment? }
 */
router.post('/', async (req, res) => {
  try {
    const { userId: userIdRaw, orderId: orderIdRaw, rating: ratingRaw, comment } = req.body;

    const orderId = parseInt(String(orderIdRaw), 10);
    if (!Number.isFinite(orderId)) {
      return res.status(400).json({ error: 'ไม่พบคำสั่งซ่อม' });
    }

    const rating = typeof ratingRaw === 'string' ? parseInt(ratingRaw, 10) : Number(ratingRaw);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'กรุณาให้คะแนน 1–5 ดาว' });
    }

    const internalUserId = await resolveInternalUserId(userIdRaw);
    if (!internalUserId) {
      return res.status(400).json({ error: 'ไม่พบผู้ใช้งาน' });
    }

    const orderRes = await pool.query(
      `SELECT id, user_id, service_status FROM orders WHERE id = $1`,
      [orderId],
    );
    if (orderRes.rows.length === 0) {
      return res.status(404).json({ error: 'ไม่พบคำสั่งซ่อม' });
    }

    const order = orderRes.rows[0];
    if (order.user_id !== internalUserId) {
      return res.status(403).json({ error: 'ไม่มีสิทธิ์รีวิวคำสั่งซ่อมนี้' });
    }

    if (order.service_status !== 'completed') {
      return res.status(400).json({ error: 'รีวิวได้เมื่อคำสั่งซ่อมดำเนินการสำเร็จเท่านั้น' });
    }

    const taRes = await pool.query(
      `SELECT technician_id FROM technician_assignments WHERE order_id = $1 ORDER BY id DESC LIMIT 1`,
      [orderId],
    );
    const technicianId = taRes.rows[0]?.technician_id ?? null;

    const commentTrimmed =
      typeof comment === 'string' && comment.trim().length > 0 ? comment.trim() : null;

    const insertRes = await pool.query(
      `INSERT INTO reviews (user_id, order_id, technician_id, rating, comment, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING id, user_id, order_id, technician_id, rating, comment, created_at`,
      [internalUserId, orderId, technicianId, rating, commentTrimmed],
    );

    return res.status(201).json(insertRes.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'ไม่สามารถรีวิวซ้ำได้',
        code: 'DUPLICATE_REVIEW',
      });
    }
    console.error('POST /api/reviews error:', error);
    return res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

export default router;
