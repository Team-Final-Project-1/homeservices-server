import pool from "../utils/db.mjs";

/* =========================================================
   GET Pending Jobs
========================================================= */

export async function getPendingJobs() {

  const query = `
    SELECT 
      o.id,
      o.status,
      o.created_at,
      o.total_price,
      array_agg(s.name) FILTER (WHERE s.name IS NOT NULL) AS services
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN services s ON oi.service_id = s.id
    WHERE o.status = 'pending'
    GROUP BY o.id
    ORDER BY o.created_at ASC
  `;

  const { rows } = await pool.query(query);

  return rows;
}


/* =========================================================
   GET In Progress Jobs (เฉพาะของช่าง)
========================================================= */

export async function getInProgressJobs(technicianId) {

  const query = `
    SELECT 
      o.id,
      o.status,
      o.created_at,
      o.total_price,
      array_agg(s.name) FILTER (WHERE s.name IS NOT NULL) AS services
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN services s ON oi.service_id = s.id
    WHERE o.status = 'in_progress'
    AND o.technician_id = $1
    GROUP BY o.id
    ORDER BY o.created_at ASC
  `;

  const { rows } = await pool.query(query, [technicianId]);

  return rows;
}


/* =========================================================
   GET JOB DETAIL
========================================================= */

export async function getJobDetail(orderId) {

  const query = `
    SELECT 
      o.id,
      o.status,
      o.created_at,
      o.total_price,
      array_agg(s.name) FILTER (WHERE s.name IS NOT NULL) AS services
    FROM orders o
    LEFT JOIN order_items oi ON o.id = oi.order_id
    LEFT JOIN services s ON oi.service_id = s.id
    WHERE o.id = $1
    GROUP BY o.id
  `;

  const { rows } = await pool.query(query, [orderId]);

  return rows[0];
}


/* =========================================================
   ACCEPT JOB
========================================================= */

export async function acceptJob(orderId, technicianId) {

  const query = `
    UPDATE orders
    SET status = 'in_progress',
        technician_id = $2
    WHERE id = $1
    RETURNING *
  `;

  const { rows } = await pool.query(query, [orderId, technicianId]);

  return rows[0];
}


/* =========================================================
   COMPLETE JOB
========================================================= */

export async function completeJob(orderId, technicianId) {

  const query = `
    UPDATE orders
    SET status = 'completed'
    WHERE id = $1
    AND technician_id = $2
    RETURNING *
  `;

  const { rows } = await pool.query(query, [orderId, technicianId]);

  return rows[0];
}


/* =========================================================
   GET COUNTERS
========================================================= */

export async function getCounters(technicianId) {

    const query = `
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE status = 'in_progress' AND technician_id = $1) AS in_progress,
        COUNT(*) FILTER (WHERE status = 'completed' AND technician_id = $1) AS completed
      FROM orders
    `;
  
    const { rows } = await pool.query(query, [technicianId]);
  
    const result = rows[0];
  
    return {
      pending: Number(result.pending),
      in_progress: Number(result.in_progress),
      completed: Number(result.completed),
    };
  }