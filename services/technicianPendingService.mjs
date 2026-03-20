import pool from "../utils/db.mjs";

/* =========================================================
   GET Pending Jobs
========================================================= */

export async function getPendingJobs(technicianId) {
  const query = `
SELECT
  o.id,
  o.service_status,
  o.created_at,
  o.net_price,

  (o.appointment_date::timestamp + COALESCE(o.appointment_time, '00:00:00')) 
    AS appointment_datetime,

  o.remark,

  CONCAT('AD', LPAD(o.id::TEXT, 8, '0')) AS order_code,

  a.address_line,

  a.latitude AS customer_lat,
  a.longitude AS customer_lng,

  u.full_name AS customer_name,
  u.phone AS customer_phone,

  ta.assigned_at,

  array_agg(DISTINCT s.name)
    FILTER (WHERE s.name IS NOT NULL) AS service_names,

  array_agg(DISTINCT si.name)
    FILTER (WHERE si.name IS NOT NULL) AS item_names

FROM orders o

JOIN technician_assignments ta
  ON ta.order_id = o.id
  AND ta.technician_id = $1
  AND ta.status = 'assigned'

LEFT JOIN addresses a ON o.address_id = a.id
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN services s ON oi.service_id = s.id
LEFT JOIN service_items si ON s.id = si.service_id

JOIN users u ON o.user_id = u.id

WHERE o.service_status = 'in_progress'

GROUP BY
  o.id,
  a.address_line,
  a.latitude,
  a.longitude,
  u.full_name,
  u.phone,
  ta.assigned_at

ORDER BY ta.assigned_at DESC
`;

  const { rows } = await pool.query(query, [technicianId]);

  return rows;
}

/* =========================================================
   GET JOB DETAIL
========================================================= */

export async function getJobDetail(orderId, technicianId) {
  const query = `
SELECT
  o.id,
  o.service_status,
  o.net_price,

  -- FIX --
  (o.appointment_date::timestamp + COALESCE(o.appointment_time, '00:00:00')) 
    AS appointment_datetime,

  o.remark,

  CONCAT('AD', LPAD(o.id::TEXT, 8, '0')) AS order_code,

  a.address_line,

  -- ✅ MAP
  a.latitude AS customer_lat,
  a.longitude AS customer_lng,

  u.full_name AS customer_name,
  u.phone AS customer_phone,

  array_agg(DISTINCT s.name)
    FILTER (WHERE s.name IS NOT NULL) AS service_names,

  array_agg(DISTINCT si.name)
    FILTER (WHERE si.name IS NOT NULL) AS item_names

FROM orders o

JOIN technician_assignments ta
  ON ta.order_id = o.id
  AND ta.technician_id = $2
  AND ta.status IN ('assigned', 'completed')

LEFT JOIN addresses a ON o.address_id = a.id
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN services s ON oi.service_id = s.id
LEFT JOIN service_items si ON s.id = si.service_id

JOIN users u ON o.user_id = u.id

WHERE o.id = $1

GROUP BY
  o.id,
  a.address_line,
  a.latitude,
  a.longitude,
  u.full_name,
  u.phone
`;

  const { rows } = await pool.query(query, [orderId, technicianId]);

  return rows[0];
}

/* =========================================================
   COMPLETE JOB
========================================================= */

export async function completeJob(orderId, technicianId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const check = await client.query(
      `SELECT 1 FROM technician_assignments
       WHERE order_id = $1 AND technician_id = $2 AND status = 'assigned'`,
      [orderId, technicianId],
    );

    if (check.rows.length === 0) {
      await client.query("ROLLBACK");
      throw new Error("ไม่มีสิทธิ์อัปเดตงานนี้");
    }

    await client.query(
      `UPDATE orders SET service_status = 'completed', updated_at = NOW()
       WHERE id = $1`,
      [orderId],
    );

    await client.query(
      `UPDATE technician_assignments
       SET status = 'completed', completed_at = NOW()
       WHERE order_id = $1 AND technician_id = $2`,
      [orderId, technicianId],
    );

    // ดึงข้อมูลลูกค้าและชื่อช่าง
    const orderResult = await client.query(
      `SELECT o.user_id, u.full_name
       FROM orders o
       JOIN users u ON u.id = $2
       WHERE o.id = $1`,
      [orderId, technicianId],
    );

    if (orderResult.rows.length > 0) {
      const { user_id, full_name } = orderResult.rows[0];
      const technicianName = full_name?.trim() || "ช่าง";

      // INSERT notification ให้ลูกค้า
      await client.query(
        `INSERT INTO notifications (user_id, order_id, type, message)
         VALUES ($1, $2, 'order_completed', $3)`,
        [user_id, orderId, `${technicianName} ดำเนินการเสร็จสิ้นแล้ว`],
      );
    }

    await client.query("COMMIT");
    return { success: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/* =========================================================
   GET COUNTERS
========================================================= */

export async function getCounters(technicianId) {
  const client = await pool.connect();
  try {
    const pendingResult = await client.query(
      `SELECT COUNT(*) AS pending
       FROM orders o
       LEFT JOIN addresses a ON o.address_id = a.id
       JOIN user_profiles up ON up.user_id = $1
       WHERE o.status = 'completed'
         AND (o.service_status IS NULL OR o.service_status = 'pending')
         AND a.latitude IS NOT NULL
         AND a.longitude IS NOT NULL
         AND up.latitude IS NOT NULL
         AND up.longitude IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM technician_assignments ta
           WHERE ta.order_id = o.id AND ta.status = 'assigned'
         )
         AND NOT EXISTS (
           SELECT 1 FROM technician_assignments ta
           WHERE ta.order_id = o.id
             AND ta.technician_id = $1
             AND ta.status = 'rejected'
         )
         AND EXISTS (
           SELECT 1 FROM order_items oi
           JOIN technician_services ts ON oi.service_id = ts.service_id
           WHERE oi.order_id = o.id AND ts.technician_id = $1
         )
         AND (6371 * acos(
           LEAST(1.0,
             cos(radians(up.latitude::float)) * cos(radians(a.latitude::float)) *
             cos(radians(a.longitude::float) - radians(up.longitude::float)) +
             sin(radians(up.latitude::float)) * sin(radians(a.latitude::float))
           )
         )) <= 10`,
      [technicianId],
    );

    const inProgressResult = await client.query(
      `SELECT COUNT(*) AS in_progress
       FROM orders o
       JOIN technician_assignments ta
         ON ta.order_id = o.id
         AND ta.technician_id = $1
         AND ta.status = 'assigned'
       WHERE o.service_status = 'in_progress'`,
      [technicianId],
    );

    return {
      pending: Number(pendingResult.rows[0].pending ?? 0),
      in_progress: Number(inProgressResult.rows[0].in_progress ?? 0),
      completed: 0,
    };
  } finally {
    client.release();
  }
}
