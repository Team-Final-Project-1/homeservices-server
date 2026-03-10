import express from 'express';
import pool from '../utils/db.mjs'; 

const router = express.Router();

// 1. GET - ดึงข้อมูลโปรโมชันทั้งหมด
router.get('/', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM promotions ORDER BY created_at DESC');
    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการดึงข้อมูล' });
  }
});

// 2. POST - สร้างโปรโมชันใหม่
router.post('/', async (req, res) => {
  try {
    const { code, type, discount_value, usage_limit, expiry_date } = req.body;
    
    const query = `
      INSERT INTO promotions (code, type, discount_value, usage_limit, used_count, expiry_date, active)
      VALUES ($1, $2, $3, $4, 0, $5, true) RETURNING *;
    `;
    const values = [code, type, discount_value, usage_limit, expiry_date];
    const result = await pool.query(query, values);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ error: "ชื่อ Promotion Code นี้มีในระบบแล้ว" });
    res.status(500).json({ error: error.message });
  }
});

// 3. PUT - แก้ไขข้อมูลและเก็บบันทึกประวัติ (Audit Log)
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { code, type, discount_value, usage_limit, expiry_date } = req.body;

    // ดึงข้อมูลเก่ามาก่อน
    const oldDataRes = await pool.query('SELECT * FROM promotions WHERE id = $1', [id]);
    if (oldDataRes.rows.length === 0) return res.status(404).json({ error: "ไม่พบข้อมูล" });
    const oldData = oldDataRes.rows[0];

    // อัปเดตข้อมูลใหม่
    const updateQuery = `
      UPDATE promotions 
      SET code = $1, type = $2, discount_value = $3, usage_limit = $4, expiry_date = $5
      WHERE id = $6 RETURNING *;
    `;
    const updateResult = await pool.query(updateQuery, [code, type, discount_value, usage_limit, expiry_date, id]);

    // บันทึกประวัติ
    let changes = [];
    if (oldData.code !== code) changes.push(`ชื่อโค้ดจาก ${oldData.code} เป็น ${code}`);
    if (Number(oldData.discount_value) !== Number(discount_value)) changes.push(`ส่วนลดจาก ${oldData.discount_value} เป็น ${discount_value}`);
    if (Number(oldData.usage_limit) !== Number(usage_limit)) changes.push(`โควต้าจาก ${oldData.usage_limit} เป็น ${usage_limit}`);
    
    if (changes.length > 0) {
      await pool.query(
        'INSERT INTO promotion_logs (promotion_id, action, detail) VALUES ($1, $2, $3)',
        [id, 'UPDATE', `แก้ไข: ${changes.join(", ")}`]
      );
    }

    res.json(updateResult.rows[0]);
  } catch (error) {
    if (error.code === '23505') return res.status(400).json({ error: "ชื่อ Promotion Code นี้มีในระบบแล้ว" });
    res.status(500).json({ error: error.message });
  }
});

// 4. DELETE - ลบโปรโมชันและเก็บบันทึก
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM promotions WHERE id = $1', [id]);
    
    // บันทึกการลบ
    await pool.query(
      'INSERT INTO promotion_logs (promotion_id, action, detail) VALUES ($1, $2, $3)',
      [id, 'DELETE', 'ลบโปรโมชันออกจากระบบ']
    );

    res.json({ message: "ลบข้อมูลสำเร็จ" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;