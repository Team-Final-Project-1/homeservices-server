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
  // ใช้ Transaction เพราะต้องอัปเดต 2 ตารางพร้อมกัน
  // ถ้าอันใดอันนึงล้มเหลว → rollback ทั้งหมด ป้องกันข้อมูลค้างครึ่งทาง
  acceptOrder: async (orderId, technicianId) => {
    // ขอ connection สำหรับ transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN"); // เริ่ม transaction
      // เช็คก่อนว่า order ยังว่างอยู่มั้ย (ป้องกัน race condition)
      // กรณีช่าง 2 คนกดรับพร้อมกัน → คนแรกได้ คนหลัง error
      const checkResult = await client.query(
        `
        SELECT 1 FROM technician_assignments 
        WHERE order_id = $1 AND status = 'assigned'`,
        [orderId],
      );
      if (checkResult.rowCount > 0) {
        await client.query("ROLLBACK");
        return { success: false, message: "งานนี้มีช่างอ่านอื่นรับไปแล้ว" };
      }
    } catch (err) {
      await client.query("ROLLBACK");
      console.error("❌ รับงานล้มเหลว:", err);
      return { success: false, message: "เกิดข้อผิดพลาดในการรับงาน" };
    }
  },
};

export default technicianOrderService;
