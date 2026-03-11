import pool from "../utils/db.mjs";

const technicianOrderService = {
  // GET AVAILABLE ORDERS
  // ดึง orders ที่ status = 'completed' (จ่ายเงินแล้ว)
  // และยังไม่มีช่างรับงาน (ไม่มีใน technician_assignments)
  getAvailableOrders: async () => {
    const result = await pool.query(`
        SELECT 
          o.id,
          o.status,
          o.total_price,
          o.created_at,
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
        LEFT JOIN service_items si ON oi.service_id = si.service_id
        WHERE o.status = 'completed'
        AND NOT EXISTS (
          SELECT 1
            FROM technician_assignments ta
            WHERE ta.order_id = o.id
            AND ta.status = 'assigned')
        GROUP BY o.id, o.status, o.total_price, o.created_at, a.address_line, a.city, a.province
        ORDER BY o.created_at DESC`);

    // mapping ข้อมูลก่อนส่งกลับไปให้ช่าง
    return result.rows.map((order) => ({
      id: order.id,
      order_code: order.order_code,
      status: order.status,
      total_price: Number(order.total_price),
      created_at: order.created_at,
      address: [order.address_line, order.city, order.province]
        .filter(Boolean)
        .join(" "),
      services_names: order.service_names.filter(Boolean), // ชื่อบริการหลักที่ไม่เป็น null แสดงชื่อการ์ด
      items_names: order.item_names.filter(Boolean), // ชื่อบริการย่อยที่ไม่เป็น null ชื่อรายการย่อยที่แสดงในรายละเอียดการ์ด
    }));
  },

  // ACCEPT ORDER — ช่างกดรับงาน
  // ใช้ Transaction เพราะต้องอัปเดต 2 ตารางพร้อมกัน (technician_assignments + orders)
  // ถ้าไม่มี transaction ช่างกดรับงานพร้อมกันหลายคน → ข้อมูลอาจจะค้างครึ่งทาง
  // เช่น มีช่าง 2 คนกดรับงานเดียวกันพร้อมกัน → ทั้งคู่เช็คว่างแล้วก็อัปเดตได้ทั้งคู่ → ข้อมูลผิดพลาด
  // ถ้าอันใดอันนึงล้มเหลว → rollback ทั้งหมด ป้องกันข้อมูลค้างครึ่งทาง
  acceptOrder: async (orderId, technicianId) => {
    // ขอ connection สำหรับ transaction
    const client = await pool.connect();
    try {
      // เริ่ม transaction หลังจากนี้ทุก query ที่รันจะยังไม่ถูกบันทึกจริง
      // จนกว่าเราจะ commit หรือ rollback
      await client.query("BEGIN");

      // เช็คก่อนว่า order ยังว่างอยู่มั้ย (ป้องกัน race condition)
      // กรณีช่าง 2 คนกดรับพร้อมกัน → คนแรกได้ คนหลัง error
      const checkResult = await client.query(
        `SELECT 1 FROM technician_assignments 
        WHERE order_id = $1 AND status = 'assigned'`,
        [orderId],
      );

      // ถ้าเจอแถวที่มี order_id นี้แล้ว → แปลว่ามีช่างรับงานนี้ไปแล้ว → rollback และแจ้ง error
      if (checkResult.rowCount > 0) {
        await client.query("ROLLBACK");
        return {
          success: false,
          message: "งานนี้ไม่ว่างแล้ว กรุณาลองใหม่อีกครั้ง",
        };
      }

      // ถ้าเช็คผ่าน → บันทึกข้อมูลการรับงาน และอัปเดตสถานะ order เป็น in_progress
      await client.query(
        `INSERT INTO technician_assignments (order_id, technician_id, status, assigned_at)
         VALUES ($1, $2, 'assigned', NOW())`,
        [orderId, technicianId],
      );

      // อัปเดตสถานะ order เป็น in_progress
      await client.query(
        `UPDATE orders SET status = 'in_progress' WHERE id = $1`,
        [orderId],
      );

      await client.query("COMMIT"); // ถ้าไม่มีปัญหา → commit เพื่อบันทึกข้อมูลจริง และแจ้ง success
      return { success: true, message: "รับงานสำเร็จ" };
      
    } catch (error) {
      await client.query("ROLLBACK"); // ถ้าเช็คมีปัญหา → rollback และแจ้ง error
      console.error("รับงานล้มเหลว:", error);
      return { success: false, message: "เกิดข้อผิดพลาดในการรับงาน" };
    } finally {
      client.release(); // ปล่อย connection กลับไปที่ pool
    }
  },
};

export default technicianOrderService;
