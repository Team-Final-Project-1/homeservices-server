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
  AND ta.status = 'assigned'

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
  const query = `
    SELECT
      COUNT(*) FILTER (
        WHERE o.service_status = 'in_progress'
        AND ta.technician_id = $1
        AND ta.status = 'assigned'
      ) AS in_progress,

      COUNT(*) FILTER (
        WHERE o.service_status = 'completed'
        AND ta.technician_id = $1
        AND ta.status = 'completed'
      ) AS completed

    FROM orders o
    JOIN technician_assignments ta ON ta.order_id = o.id
    WHERE ta.technician_id = $1
  `;

  const { rows } = await pool.query(query, [technicianId]);
  const result = rows[0];

  return {
    in_progress: Number(result.in_progress ?? 0),
    completed: Number(result.completed ?? 0),
  };
}
