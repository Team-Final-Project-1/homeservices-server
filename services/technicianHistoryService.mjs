import pool from "../utils/db.mjs";

export const getTechnicianHistory = async (technicianId) => {
  try {
    const query = `
      SELECT 
        s.name AS service_name,
        o.id AS order_id,
        o.created_at AS operation_date,
        o.total_price AS total_price,
        o.status
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN services s ON oi.service_id = s.id
      JOIN technician_assignments ta ON o.id = ta.order_id
      WHERE ta.technician_id = $1
        AND ta.status = 'completed'
      ORDER BY o.created_at DESC;
    `;

    const result = await pool.query(query, [technicianId]);

    // ฟอร์แมตข้อมูลให้ตรงกับ UI ในรูปภาพ
    const formattedHistory = result.rows.map((row) => ({
      service_name: row.service_name,
      order_code: `AD${String(row.order_id).padStart(8, "0")}`, // ฟอร์แมตเป็น AD04071205
      date_time:
        new Date(row.operation_date).toLocaleString("th-TH", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }) + " น.", // ฟอร์แมตวันที่ 25/04/2563 เวลา 13.00 น.
      total_price:
        Number(row.total_price).toLocaleString("th-TH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }) + " ฿", // ฟอร์แมต 1,550.00 ฿
    }));

    return formattedHistory;
  } catch (error) {
    console.error("Error fetching technician history:", error);
    throw error;
  }
};

export const getTechnicianHistoryDetail = async (orderId) => {
  try {
    const query = `
      SELECT 
        o.id AS order_id,
        o.created_at AS operation_date,
        o.total_price AS total_price,
        a.address_line AS address,
        a.latitude,
        a.longitude,
        u.username AS customer_name,
        u.phone AS customer_phone,
        r.rating,
        r.comment AS review_comment,
        c.name_th AS category_name,
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'name', s.name,
            'quantity', oi.quantity,
            'price', oi.price
          )
        ) AS items
      FROM orders o
      JOIN order_items oi ON o.id = oi.order_id
      JOIN services s ON oi.service_id = s.id
      JOIN categories c ON s.category_id = c.id
      LEFT JOIN addresses a ON o.address_id = a.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN reviews r ON o.id = r.order_id
      WHERE o.id = $1
      GROUP BY o.id, c.name_th, a.address_line, a.latitude, a.longitude, u.username, u.phone, r.rating, r.comment;
    `;

    const result = await pool.query(query, [orderId]);

    if (result.rows.length === 0) return null;

    const row = result.rows[0];

    // ฟอร์แมตข้อมูลให้ตรงกับ UI รายละเอียดคำสั่งซ่อม
    return {
      service_name: row.items[0]?.name, // ใช้ชื่อบริการแรกเป็นหัวข้อ
      category_name: row.category_name,
      items: row.items, // ส่งเป็น array ให้ frontend ไป loop แสดงผล
      date_time:
        new Date(row.operation_date).toLocaleString("th-TH", {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }) + " น.",
      address: row.address,
      latitude: row.latitude ? Number(row.latitude) : null,
      longitude: row.longitude ? Number(row.longitude) : null,
      order_code: `AD${String(row.order_id).padStart(8, "0")}`,
      total_price:
        Number(row.total_price).toLocaleString("th-TH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        }) + " ฿",
      customer_name: row.customer_name,
      customer_phone: row.customer_phone,
      rating: row.rating || 0,
      review_comment: row.review_comment || "ไม่มีความคิดเห็นจากผู้รับบริการ",
    };
  } catch (error) {
    console.error("Error fetching history detail:", error);
    throw error;
  }
};
