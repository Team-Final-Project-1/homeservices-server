import pool from "../utils/db.mjs";

const technicianOrderService = {
  getAvailableOrders: async (technicianId, radiusKm = 10) => {
    const result = await pool.query(
      `
      SELECT
        o.id,
        o.status,
        o.net_price,
        o.created_at,
        o.appointment_date,
        o.appointment_time,
        o.remark,
        CONCAT('AD', LPAD(o.id::TEXT, 8, '0')) AS order_code,
        CONCAT_WS(' ', a.address_line, a.subdistrict, a.district, a.province, a.postal_code) AS address_line,
        a.latitude AS customer_lat,
        a.longitude AS customer_lng,

        u.full_name AS customer_name,
        u.phone AS customer_phone,

        ROUND((6371 * acos(
          LEAST(1.0,
            cos(radians(up.latitude::float)) * cos(radians(a.latitude::float)) *
            cos(radians(a.longitude::float) - radians(up.longitude::float)) +
            sin(radians(up.latitude::float)) * sin(radians(a.latitude::float))
          )
        ))::numeric, 1) AS distance_km,

        array_agg(DISTINCT s.name) AS service_names,
        array_agg(DISTINCT si.name) FILTER (WHERE si.name IS NOT NULL) AS item_names

      FROM orders o
      LEFT JOIN addresses a ON o.address_id = a.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN services s ON oi.service_id = s.id
      LEFT JOIN service_items si ON si.id = oi.service_item_id
      JOIN user_profiles up ON up.user_id = $1
      JOIN users u ON o.user_id = u.id

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
          FROM order_items oi2
          JOIN technician_services ts ON oi2.service_id = ts.service_id
          WHERE oi2.order_id = o.id
            AND ts.technician_id = $1
        )

        AND a.latitude IS NOT NULL
        AND a.longitude IS NOT NULL
        AND up.latitude IS NOT NULL
        AND up.longitude IS NOT NULL

      GROUP BY o.id, o.status, o.net_price, o.created_at,
         o.appointment_date, o.appointment_time, o.remark,
         a.address_line,
         a.subdistrict,
         a.district,
         a.province,
         a.postal_code,
         a.latitude, a.longitude,
         up.latitude, up.longitude,
         u.full_name, u.phone

      HAVING (6371 * acos(
        LEAST(1.0,
          cos(radians(up.latitude::float)) * cos(radians(a.latitude::float)) *
          cos(radians(a.longitude::float) - radians(up.longitude::float)) +
          sin(radians(up.latitude::float)) * sin(radians(a.latitude::float))
        )
      )) <= $2

      ORDER BY o.created_at DESC
      `,
      [technicianId, radiusKm],
    );

    return result.rows.map((order) => ({
      id: order.id,
      order_code: order.order_code,
      status: order.status,
      net_price: Number(order.net_price),
      created_at: order.created_at,
      appointment_date: order.appointment_date,
      appointment_time: order.appointment_time,
      remark: order.remark,
      address: order.address_line ?? "-",
      customer_lat: order.customer_lat ? Number(order.customer_lat) : null,
      customer_lng: order.customer_lng ? Number(order.customer_lng) : null,
      distance_km: Number(order.distance_km),
      service_names: (order.service_names ?? []).filter(Boolean),
      item_names: (order.item_names ?? []).filter(Boolean),
      customer_name: order.customer_name ?? "-",
      customer_phone: order.customer_phone ?? "-",
    }));
  },

  acceptOrder: async (orderId, technicianId) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const checkResult = await client.query(
        `SELECT 1 FROM technician_assignments
         WHERE order_id = $1 AND status = 'assigned'`,
        [orderId],
      );
      if (checkResult.rows.length > 0) {
        await client.query("ROLLBACK");
        return { success: false, message: "งานนี้ถูกรับไปแล้ว" };
      }
      await client.query(
        `INSERT INTO technician_assignments (order_id, technician_id, status, assigned_at)
         VALUES ($1, $2, 'assigned', NOW())`,
        [orderId, technicianId],
      );

      //  ลบ technician_id ออก
      await client.query(
        `UPDATE orders 
         SET 
           service_status = 'in_progress',
           updated_at = NOW()
         WHERE id = $1`,
        [orderId],
      );

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

        await client.query(
          `INSERT INTO notifications (user_id, order_id, type, message)
         VALUES ($1, $2, 'order_accepted', $3)`,
          [
            user_id,
            orderId,
            `${technicianName} รับงานของคุณแล้ว กำลังดำเนินการ`,
          ],
        );
      }

      await client.query("COMMIT");
      return { success: true, message: "รับงานสำเร็จ" };
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  },

  rejectOrder: async (orderId, technicianId) => {
    await pool.query(
      `INSERT INTO technician_assignments (order_id, technician_id, status, rejected_at)
       VALUES ($1, $2, 'rejected', NOW())`,
      [orderId, technicianId],
    );
    return { success: true, message: "ปฏิเสธงานสำเร็จ" };
  },

  createTechnicianNotificationsForOrder: async (orderId, radiusKm = 10) => {
    const result = await pool.query(
      `
      INSERT INTO technician_notifications (technician_id, order_id, type, message)
      SELECT DISTINCT
        tech.id AS technician_id,
        o.id AS order_id,
        'new_order' AS type,
        CONCAT('มีงานใหม่ AD', LPAD(o.id::TEXT, 8, '0'), ' เข้ามาในพื้นที่ของคุณ') AS message
      FROM orders o
      JOIN addresses a ON a.id = o.address_id
      JOIN order_items oi ON oi.order_id = o.id
      JOIN users tech ON tech.role = 'technician'
      JOIN user_profiles up ON up.user_id = tech.id
      JOIN technician_services ts
        ON ts.technician_id = tech.id
       AND ts.service_id = oi.service_id
      WHERE o.id = $1
        AND o.status = 'completed'
        AND (o.service_status IS NULL OR o.service_status = 'pending')
        AND up.is_available IS TRUE
        AND a.latitude IS NOT NULL
        AND a.longitude IS NOT NULL
        AND up.latitude IS NOT NULL
        AND up.longitude IS NOT NULL
        AND (6371 * acos(
          LEAST(1.0,
            cos(radians(up.latitude::float)) * cos(radians(a.latitude::float)) *
            cos(radians(a.longitude::float) - radians(up.longitude::float)) +
            sin(radians(up.latitude::float)) * sin(radians(a.latitude::float))
          )
        )) <= $2
        AND NOT EXISTS (
          SELECT 1
          FROM technician_notifications tn
          WHERE tn.technician_id = tech.id
            AND tn.order_id = o.id
            AND tn.type = 'new_order'
        )
      RETURNING id
      `,
      [orderId, radiusKm],
    );

    return result.rowCount ?? 0;
  },
};

export default technicianOrderService;
