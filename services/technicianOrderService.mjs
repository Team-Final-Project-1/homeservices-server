import pool from "../utils/db.mjs";

const technicianOrderService = {
  // GET AVAILABLE ORDERS
  // ดึง orders ที่ status = 'completed' (จ่ายเงินแล้ว)
  // และยังไม่มีช่างรับ + ช่างคนนี้ยังไม่เคยปฏิเสธ order นี้
  getAvailableOrders: async (technicianId) => {
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
        a.address_line,
        a.city,
        a.province,
        array_agg(DISTINCT s.name) AS service_names,
        array_agg(DISTINCT si.name) FILTER (WHERE si.name IS NOT NULL) AS item_names

      FROM orders o
      LEFT JOIN addresses a ON o.address_id = a.id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN services s ON oi.service_id = s.id
      LEFT JOIN service_items si ON s.id = si.service_id

      WHERE o.status = 'completed'
        AND NOT EXISTS (
          SELECT 1 FROM technician_assignments ta
          WHERE ta.order_id = o.id
            AND ta.status = 'assigned'
        )
        AND NOT EXISTS (
          SELECT 1 FROM technician_assignments ta
          WHERE ta.order_id = o.id
            AND ta.technician_id = $1
            AND ta.status = 'rejected'
        )

      GROUP BY o.id, o.status, o.net_price, o.created_at,
               o.appointment_date, o.appointment_time, o.remark,
               a.address_line, a.city, a.province
      ORDER BY o.created_at DESC
      `,
      [technicianId],
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
      address: [order.address_line, order.city, order.province]
        .filter(Boolean)
        .join(" "),
      service_names: order.service_names.filter(Boolean),
      item_names: order.item_names.filter(Boolean),
    }));
  },

  // ACCEPT ORDER — ช่างกดรับงาน
  // ใช้ Transaction เพราะต้องอัปเดต 2 ตารางพร้อมกัน
  // ถ้าอันใดอันนึงล้มเหลว → rollback ทั้งหมด
  acceptOrder: async (orderId, technicianId) => {
    const client = await pool.connect();

    try {
      await client.query("BEGIN");

      // เช็คก่อนว่า order ยังว่างอยู่มั้ย (ป้องกัน race condition)
      // ถ้ามีช่างคนอื่นรับไปแล้ว → rollback และ return ว่างานนี้ถูกรับไปแล้ว
      // ป้องกันกรณีที่ 2 ช่างกดรับงานเดียวกันพร้อมกัน
      const checkResult = await client.query(
        `SELECT 1 FROM technician_assignments
         WHERE order_id = $1 AND status = 'assigned'`,
        [orderId],
      );

      if (checkResult.rows.length > 0) {
        await client.query("ROLLBACK");
        return { success: false, message: "งานนี้ถูกรับไปแล้ว" };
      }

      // 1. บันทึกว่าช่างคนนี้รับงาน
      await client.query(
        `INSERT INTO technician_assignments (order_id, technician_id, status, assigned_at)
         VALUES ($1, $2, 'assigned', NOW())`,
        [orderId, technicianId],
      );

      // 2. อัปเดต status ของ order → in_progress
      await client.query(
        `UPDATE orders SET service_status = 'in_progress', updated_at = NOW()
         WHERE id = $1`,
        [orderId],
      );

      await client.query("COMMIT");
      return { success: true, message: "รับงานสำเร็จ" };
    } catch (error) {
      // ถ้า error ตรงไหนก็ตาม → ยกเลิกทุกอย่าง
      // ป้องกันข้อมูลค้างครึ่งทาง เช่น INSERT สำเร็จแต่ UPDATE ล้มเหลว
      await client.query("ROLLBACK");
      throw error;
    } finally {
      // คืน connection กลับ pool เสมอ ไม่ว่าจะสำเร็จหรือไม่
      // ถ้าไม่ release → connection หมด → server แฮงค์
      client.release();
    }
  },

  // REJECT ORDER — ช่างกดปฏิเสธงาน
  // บันทึกว่าช่างคนนี้ปฏิเสธ แต่ order ยังคง status เดิม
  // เพื่อให้ช่างคนอื่นยังเห็นและรับได้
  rejectOrder: async (orderId, technicianId) => {
    await pool.query(
      `INSERT INTO technician_assignments (order_id, technician_id, status, rejected_at)
       VALUES ($1, $2, 'rejected', NOW())`,
      [orderId, technicianId],
    );

    return { success: true, message: "ปฏิเสธงานสำเร็จ" };
  },
};

export default technicianOrderService;
