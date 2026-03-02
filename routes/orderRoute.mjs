import express from 'express';
import pool from '../utils/db.mjs'; 

const router = express.Router();

// ดึงข้อมูลออเดอร์ของ User ตาม ID
router.get('/my-orders/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    // SQL Query ดึงข้อมูลและ Join ตารางที่เกี่ยวข้อง
    const query = `
      SELECT 
        o.id, 
        o.status, 
        o.created_at as date, 
        o.total_price as price,  --  ใน public.txt คุณใช้คำว่า total_price นะครับ ไม่ใช่ net_price
        tp.full_name as worker,
        array_agg(s.name) as details
      FROM orders o
      INNER JOIN users u ON o.user_id = u.id -- 1. เพิ่มบรรทัดนี้เพื่อเชื่อมตาราง users
      LEFT JOIN technician_assignments ta ON o.id = ta.order_id
      LEFT JOIN user_profiles tp ON ta.technician_id = tp.user_id
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN services s ON oi.service_id = s.id
      WHERE u.auth_user_id = $1              -- 2. เปลี่ยนมาเทียบกับ auth_user_id แทน
      GROUP BY o.id, o.status, o.created_at, o.total_price, tp.full_name
      ORDER BY o.created_at DESC;
    `;

    const { rows } = await pool.query(query, [userId]);

    // จัดรูปแบบข้อมูลเล็กน้อยก่อนส่งกลับ (Format วันที่, ราคา)
    const formattedOrders = rows.map(order => ({
      id: `AD${String(order.id).padStart(8, '0')}`, // จำลองรหัสออเดอร์ เช่น AD00000012
      status: order.status, 
      // แปลงวันที่ให้อ่านง่ายขึ้น
      date: new Date(order.date).toLocaleString('th-TH', { 
        year: 'numeric', month: '2-digit', day: '2-digit', 
        hour: '2-digit', minute: '2-digit' 
      }) + ' น.',
      worker: order.worker || 'รอการจัดสรรช่าง', // ถ้ายังไม่มีช่าง
      price: Number(order.price).toLocaleString('th-TH', { minimumFractionDigits: 2 }),
      details: order.details.filter(d => d !== null) // กรองค่า null ออก
    }));

    res.json(formattedOrders);

  } catch (error) {
    console.error("Error fetching orders:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

 // #บรรทัดนี้จะต้องถูกลบเมื่อเสรร็จงาน 
// POST /api/orders/mock - ยิงเพื่อสร้างออเดอร์จำลองสำหรับทดสอบ UI
router.post('/mock', async (req, res) => {
  try {
    const { auth_user_id } = req.body;

    // 1. ตรวจสอบว่ามี User นี้ในตาราง public.users หรือยัง (ถ้ายัง ให้สร้างอัตโนมัติ)
    let internalUserId;
    const userRes = await pool.query('SELECT id FROM users WHERE auth_user_id = $1', [auth_user_id]);
    
    if (userRes.rows.length === 0) {
        const newUserRes = await pool.query(
            'INSERT INTO users (auth_user_id, email, username) VALUES ($1, $2, $3) RETURNING id',
            [auth_user_id, `mock${Date.now()}@test.com`, `user_${Date.now()}`]
        );
        internalUserId = newUserRes.rows[0].id;
    } else {
        internalUserId = userRes.rows[0].id;
    }

    // 2. สร้างข้อมูลที่อยู่จำลอง (เพราะตาราง orders บังคับมี address_id)
    const addrRes = await pool.query(
      'INSERT INTO addresses (user_id, address_line) VALUES ($1, $2) RETURNING id',
      [internalUserId, '123/45 หมู่บ้านทดสอบ ถ.สมมติ']
    );
    const addressId = addrRes.rows[0].id;

    // 3. สร้างหมวดหมู่และบริการจำลองเพื่อเอาไปแสดงผล
    const catRes = await pool.query(
      'INSERT INTO categories (name, name_th) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET name=EXCLUDED.name RETURNING id',
      ['Air Condition (Mock)', 'แอร์บ้าน (จำลอง)']
    );
    const catId = catRes.rows[0].id;

    const srvRes = await pool.query(
      'INSERT INTO services (category_id, name, price) VALUES ($1, $2, $3) RETURNING id',
      [catId, 'ล้างแอร์ติดผนัง', 500]
    );
    const serviceId = srvRes.rows[0].id;

    // 4. สร้างใบสั่งซ่อม (Order)
    const orderRes = await pool.query(
      `INSERT INTO orders (user_id, address_id, status, net_price) 
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [internalUserId, addressId, 'in_progress', 500] // ✅ เปลี่ยนเป็น in_progress
    );
    const orderId = orderRes.rows[0].id;

    // 5. นำบริการไปใส่ในใบสั่งซ่อม (Order Items)
    await pool.query(
      'INSERT INTO order_items (order_id, service_id, quantity, price) VALUES ($1, $2, $3, $4)',
      [orderId, serviceId, 1, 500]
    );

    res.status(201).json({ message: "🎉 สร้างข้อมูลออเดอร์จำลองสำเร็จ!", orderId });

  } catch (error) {
    console.error("Mock Error:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาด: " + error.message });
  }
});

// #บรรทัดที่ต้องถูกลบจะสุดที่ตรงนี้

export default router;