import express from 'express';
import pool from '../utils/db.mjs'; 

const router = express.Router();

// GET /api/orders/my-orders/:userId - ดึงข้อมูลออเดอร์ของ User ตาม ID (แบบละเอียด)
router.get('/my-orders/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const isNumeric = /^[0-9]+$/.test(userId);
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId);

    // ถ้าไม่ใช่ทั้ง integer และ UUID (เช่น "null", "undefined") ให้ return ทันที
    if (!isNumeric && !isUUID) {
      return res.json([]);
    }

    let internalUserId;

    if (isNumeric) {
      // internal integer id — ใช้ได้เลย
      internalUserId = parseInt(userId, 10);
    } else {
      // Supabase auth UUID — lookup internal id
      const { rows: userRows } = await pool.query(
        'SELECT id FROM users WHERE auth_user_id = $1::uuid',
        [userId]
      );
      if (userRows.length === 0) return res.json([]);
      internalUserId = userRows[0].id;
    }

    const query = `
      SELECT
        o.id,
        o.service_status AS status,
        o.created_at AS date,
        o.net_price AS price,
        up.full_name AS worker,
        array_agg(s.name) FILTER (WHERE s.name IS NOT NULL) AS details
      FROM orders o

      LEFT JOIN LATERAL (
        SELECT technician_id
        FROM technician_assignments ta
        WHERE ta.order_id = o.id
        ORDER BY ta.id DESC
        LIMIT 1
      ) ta ON true

      LEFT JOIN user_profiles up 
        ON ta.technician_id = up.user_id

      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN services s ON oi.service_id = s.id
      WHERE o.user_id = $1
      GROUP BY o.id, o.service_status, o.created_at, o.net_price, up.full_name
      ORDER BY o.created_at DESC
    `;

    // 🌟 เปลี่ยนจาก [userId] เป็น [internalUserId]
    const { rows } = await pool.query(query, [internalUserId]);

    // จัดรูปแบบสถานะเป็นภาษาไทย
    const formattedRows = rows.map(order => {
      let thaiStatus = order.status;
      if (order.status === 'pending') thaiStatus = 'รอดำเนินการ';
      if (order.status === 'in_progress') thaiStatus = 'กำลังดำเนินการ';
      if (order.status === 'completed') thaiStatus = 'ดำเนินการสำเร็จ';
      if (order.status === 'cancelled') thaiStatus = 'ยกเลิกคำสั่งซ่อม';

      return {
        ...order,
        status: thaiStatus, 
        worker: order.worker || 'ยังไม่ระบุช่าง', 
        details: order.details ? order.details.filter(d => d != null) : []
      };
    });

    res.json(formattedRows);

  } catch (error) {
    console.error('Error fetching orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET Order Detail by ID
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const query = `
      SELECT
        o.id,
        o.service_status AS status,
        o.created_at,
        o.total_price,
        o.net_price,
        o.appointment_date,
        o.appointment_time,
        array_agg(s.name) FILTER (WHERE s.name IS NOT NULL) AS services,
        up.full_name AS technician_name,
        up.phone AS technician_phone,
        a.address_line,
        a.district,
        a.province,
        a.postal_code
      FROM orders o

      LEFT JOIN LATERAL (
        SELECT technician_id
        FROM technician_assignments ta
        WHERE ta.order_id = o.id
        ORDER BY ta.id DESC
        LIMIT 1
      ) ta ON true

      LEFT JOIN user_profiles up 
        ON ta.technician_id = up.user_id

      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN services s ON oi.service_id = s.id
      LEFT JOIN addresses a ON o.user_id = a.user_id
      WHERE o.id = $1
      GROUP BY o.id, up.full_name, up.phone, a.address_line, a.district, a.province, a.postal_code
    `;

    const { rows } = await pool.query(query, [id]);
    if (rows.length === 0) return res.status(404).json({ error: "Order not found" });
    res.json(rows[0]);

  } catch (error) {
    console.error("Error fetching order detail:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default router;