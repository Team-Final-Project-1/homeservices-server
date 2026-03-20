import express from 'express';
import pool from '../utils/db.mjs'; 
import multer from 'multer';
import { createClient } from '@supabase/supabase-js';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ==========================================
// 1. API ดึงข้อมูลส่วนตัว (GET)
// ==========================================
router.get('/:authUserUuid/address', async (req, res) => {
  try {
    const { authUserUuid } = req.params;
    
    // 🌟 ดึง profile_pic จากตาราง users โดยตรง (เลิกใช้ user_profiles)
    const userRes = await pool.query(`
      SELECT id, email, full_name AS name, phone, username, profile_pic 
      FROM users 
      WHERE auth_user_id = $1
    `, [authUserUuid]);

    if (userRes.rows.length === 0) return res.json({});
    const userData = userRes.rows[0];
    const internalUserId = userData.id;

    const addressRes = await pool.query('SELECT * FROM addresses WHERE user_id = $1', [internalUserId]);
    
    if (addressRes.rows.length === 0) {
       return res.json({
          email: userData.email || '',
          name: userData.name || '',
          phone: userData.phone || '',
          username: userData.username || '',
          profile_pic: userData.profile_pic
       });
    }

    const addr = addressRes.rows[0];

    res.json({
      email: userData.email || '',
      name: userData.name || '',
      phone: userData.phone || '',
      username: userData.username || '',
      address_line: addr.address_line || '', // 👈 ส่งบ้านเลขที่เดี่ยวๆ (เรื่องตำบลจบที่นี่)
      sub_district: addr.sub_district || '',
      district: addr.district || '',
      province: addr.province || '',
      postal_code: addr.postal_code || '',
      latitude: addr.latitude || null,
      longitude: addr.longitude || null,
      profile_pic: userData.profile_pic // ส่งรูปกลับไป
    });
  } catch (error) {
    console.error('Error fetching address:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. API บันทึกข้อมูลและรูปภาพ (POST)
// ==========================================
router.post('/:authUserUuid/update-profile', upload.single('profileImage'), async (req, res) => {
  try {
    const { authUserUuid } = req.params;
    const { name, phone, username, address_line, sub_district, district, province, postal_code, latitude, longitude } = req.body;

    // 1. หา User ปัจจุบัน และดึงรูปเก่ามาเก็บไว้ก่อน (เผื่อรอบนี้ไม่ได้อัปโหลดรูปใหม่)
    const userRes = await pool.query('SELECT id, profile_pic FROM users WHERE auth_user_id = $1', [authUserUuid]);
    if (userRes.rows.length === 0) return res.status(404).json({ error: 'ไม่พบผู้ใช้งาน' });

    const internalUserId = userRes.rows[0].id;
    let profilePicUrl = userRes.rows[0].profile_pic;

    // 2. 📸 ถ้ามีการเลือกไฟล์รูปใหม่มาด้วย ให้เอาไปขึ้น Storage
    if (req.file) {
      const fileExt = req.file.originalname.split('.').pop();
      const fileName = `${authUserUuid}-${Date.now()}.${fileExt}`; // ชื่อไฟล์ไม่ซ้ำแน่นอน

      const { error: uploadError } = await supabase.storage
        .from('avatars-picture') 
        .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });

      if (uploadError) throw uploadError;

      // ได้ URL ใหม่ของรูปนี้มา
      profilePicUrl = supabase.storage.from('avatars-picture').getPublicUrl(fileName).data.publicUrl;
    }

    // 3. 🌟 อัปเดตข้อมูลทั้งหมด (รวมถึง URL รูป) ลงในตาราง users ทันที! แบบรูปใครรูปมัน
    await pool.query(`
      UPDATE users 
      SET full_name = $1, phone = $2, username = $3, profile_pic = $4
      WHERE id = $5
    `, [name || '', phone || '', username || '', profilePicUrl, internalUserId]);

    // 3b. Keep user_profiles in sync so joins that read up.profile_pic stay correct
    try {
      await pool.query(
        `UPDATE user_profiles
         SET profile_pic = $2, avatar_url = $2, updated_at = NOW()
         WHERE user_id = $1`,
        [internalUserId, profilePicUrl],
      );
    } catch (syncErr) {
      console.error('user_profiles sync (non-fatal):', syncErr);
    }

    // 4. จัดการบันทึกที่อยู่ (เซฟเฉพาะบ้านเลขที่ เลิกเอาตำบลมาต่อท้าย)
    if (address_line || province) {
      const combinedAddressLine = address_line;
      
      const checkExist = await pool.query('SELECT id FROM addresses WHERE user_id = $1', [internalUserId]);

      if (checkExist.rows.length > 0) {
        await pool.query(`
          UPDATE addresses 
          SET address_line = $1, sub_district = $2, district = $3, province = $4, postal_code = $5,
              latitude = $6, longitude = $7
          WHERE user_id = $8
        `, [combinedAddressLine, sub_district || '', district, province, postal_code, latitude || null, longitude || null, internalUserId]);
      } else {
        await pool.query(`
          INSERT INTO addresses (user_id, address_line, sub_district, district, province, postal_code, latitude, longitude)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [internalUserId, combinedAddressLine, sub_district || '', district, province, postal_code, latitude || null, longitude || null]);
      }
    }

    res.status(200).json({ message: 'อัปเดตข้อมูลสำเร็จ', profilePicUrl });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล' });
  }
});

export default router;