import pool from "../utils/db.mjs";

export async function getTechnicianDashboard(technicianId) {
  const client = await pool.connect();

  try {
    // pending (งานที่รอรับ) — ใช้ logic เดียวกับ counters
    const pendingResult = await client.query(
      `SELECT COUNT(*) AS pending
       FROM orders o
       WHERE o.status = 'completed'
         AND (o.service_status IS NULL OR o.service_status = 'pending')
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
           SELECT 1
           FROM order_items oi
           JOIN technician_services ts ON oi.service_id = ts.service_id
           WHERE oi.order_id = o.id
             AND ts.technician_id = $1
         )`,
      [technicianId],
    );

    // in_progress (งานที่กำลังทำ)
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

    // completed (งานที่เสร็จแล้ว)
    const completedResult = await client.query(
      `SELECT COUNT(*) AS completed
       FROM technician_assignments ta
       WHERE ta.technician_id = $1
         AND ta.status = 'completed'`,
      [technicianId],
    );

    // avg rating (อิงจากงานที่ assignment เป็น completed ของช่างคนนี้)
    const avgRatingResult = await client.query(
      `SELECT AVG(r.rating)::float AS avg_rating
       FROM reviews r
       JOIN technician_assignments ta
         ON ta.order_id = r.order_id
        AND ta.technician_id = $1
        AND ta.status = 'completed'`,
      [technicianId],
    );

    // total hours (ชั่วโมงรวมจาก assigned -> completed)
    const totalHoursResult = await client.query(
      `SELECT
         COALESCE(
           SUM(EXTRACT(EPOCH FROM (ta.completed_at - ta.assigned_at)) / 3600.0),
           0
         ) AS total_hours
       FROM technician_assignments ta
       WHERE ta.technician_id = $1
         AND ta.status = 'completed'
         AND ta.assigned_at IS NOT NULL
         AND ta.completed_at IS NOT NULL`,
      [technicianId],
    );

    // monthly completed counts
    const monthCounts = await client.query(
      `SELECT
        COUNT(*) FILTER (
          WHERE ta.completed_at >= date_trunc('month', NOW())
            AND ta.completed_at < (date_trunc('month', NOW()) + interval '1 month')
        ) AS this_month_completed,
        COUNT(*) FILTER (
          WHERE ta.completed_at >= date_trunc('month', NOW() - interval '1 month')
            AND ta.completed_at < date_trunc('month', NOW())
        ) AS last_month_completed
      FROM technician_assignments ta
      WHERE ta.technician_id = $1
        AND ta.status = 'completed'`,
      [technicianId],
    );

    // performance raw: daily completed (last 90 days, include zero days)
    const performanceRawResult = await client.query(
      `WITH days AS (
         SELECT generate_series(
           (CURRENT_DATE - interval '90 days')::date,
           CURRENT_DATE::date,
           interval '1 day'
         )::date AS day
       ),
       counts AS (
         SELECT ta.completed_at::date AS day, COUNT(*)::int AS value
         FROM technician_assignments ta
         WHERE ta.technician_id = $1
           AND ta.status = 'completed'
           AND ta.completed_at >= (CURRENT_DATE - interval '90 days')
         GROUP BY ta.completed_at::date
       )
       SELECT to_char(d.day, 'YYYY-MM-DD') AS date,
              COALESCE(c.value, 0)::int AS value
       FROM days d
       LEFT JOIN counts c ON c.day = d.day
       ORDER BY d.day`,
      [technicianId],
    );

    // top tasks (services) — จากงานที่ assignment เป็น completed
    const topTasksResult = await client.query(
      `SELECT
         s.id::text AS id,
         s.name AS "jobName",
         COUNT(*)::int AS count
       FROM technician_assignments ta
       JOIN order_items oi ON oi.order_id = ta.order_id
       JOIN services s ON s.id = oi.service_id
       WHERE ta.technician_id = $1
         AND ta.status = 'completed'
       GROUP BY s.id, s.name
       ORDER BY COUNT(*) DESC
       LIMIT 5`,
      [technicianId],
    );

    const total_pending = Number(pendingResult.rows?.[0]?.pending ?? 0);
    const total_in_progress = Number(inProgressResult.rows?.[0]?.in_progress ?? 0);
    const total_completed = Number(completedResult.rows?.[0]?.completed ?? 0);

    const completion_rate =
      total_completed + total_in_progress > 0
        ? (total_completed / (total_completed + total_in_progress)) * 100
        : 0;

    return {
      total_completed,
      total_in_progress,
      total_pending,
      avg_rating:
        avgRatingResult.rows?.[0]?.avg_rating === null
          ? null
          : Number(avgRatingResult.rows[0].avg_rating),
      total_hours: Number(totalHoursResult.rows?.[0]?.total_hours ?? 0),
      completion_rate,
      this_month_completed: Number(
        monthCounts.rows?.[0]?.this_month_completed ?? 0,
      ),
      last_month_completed: Number(
        monthCounts.rows?.[0]?.last_month_completed ?? 0,
      ),
      performance_raw: performanceRawResult.rows ?? [],
      top_tasks: topTasksResult.rows ?? [],
    };
  } finally {
    client.release();
  }
}

