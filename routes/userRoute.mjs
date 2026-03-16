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
router.get('/:userId/address', async (req, res) => {
  try {
    const { userId } = req.params;
    
    const isNumeric = /^[0-9]+$/.test(userId);
    const queryColumn = isNumeric ? 'u.id' : 'u.auth_user_id';

    const userRes = await pool.query(`
      SELECT 
        u.id, u.email, u.full_name AS name, u.phone, u.username, 
        up.profile_pic 
      FROM users u
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE ${queryColumn} = $1
    `, [userId]);

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
      address_line: addr.address_line || '', 
      sub_district: addr.subdistrict || '', // 🌟 ดึงค่า subdistrict ส่งกลับไปให้หน้าเว็บ
      district: addr.district || '',
      province: addr.province || '',
      postal_code: addr.postal_code || '',
      profile_pic: userData.profile_pic 
    });
  } catch (error) {
    console.error('Error fetching address:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// 2. API บันทึกข้อมูลและรูปภาพ (POST)
// ==========================================
router.post('/:userId/update-profile', upload.single('profileImage'), async (req, res) => {
  try {
    const { userId } = req.params;
    
    // 🌟 1. ดักจับค่าตำบล (sub_district) จาก Frontend 
    const { name, phone, username, address_line, sub_district, district, province, postal_code } = req.body;
    
    // 🕵️‍♂️ ปริ้นท์เช็คใน Terminal เลยว่าตำบลถูกส่งมาไหม!
    console.log("📥 ข้อมูลที่ได้รับจากหน้าเว็บ:", { address_line, sub_district, district, province });

    const isNumeric = /^[0-9]+$/.test(userId);
    const queryColumn = isNumeric ? 'u.id' : 'u.auth_user_id';

    const userRes = await pool.query(`
      SELECT u.id, up.profile_pic 
      FROM users u 
      LEFT JOIN user_profiles up ON u.id = up.user_id
      WHERE ${queryColumn} = $1
    `, [userId]);

    if (userRes.rows.length === 0) return res.status(404).json({ error: 'ไม่พบผู้ใช้งาน' });

    const internalUserId = userRes.rows[0].id;
    let profilePicUrl = userRes.rows[0].profile_pic;

    // อัปโหลดรูปใหม่ (ถ้ามี)
    if (req.file) {
      const fileExt = req.file.originalname.split('.').pop();
      const fileName = `${internalUserId}-${Date.now()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars-picture') 
        .upload(fileName, req.file.buffer, { contentType: req.file.mimetype });

      if (uploadError) throw uploadError;
      profilePicUrl = supabase.storage.from('avatars-picture').getPublicUrl(fileName).data.publicUrl;
    }

    // อัปเดต users
    await pool.query(`
      UPDATE users 
      SET full_name = $1, phone = $2, username = $3
      WHERE id = $4
    `, [name || '', phone || '', username || '', internalUserId]);

    // อัปเดต user_profiles
    const profileExist = await pool.query('SELECT id FROM user_profiles WHERE user_id = $1', [internalUserId]);
    if (profileExist.rows.length === 0) {
      await pool.query(`
        INSERT INTO user_profiles (user_id, full_name, phone, profile_pic) 
        VALUES ($1, $2, $3, $4)
      `, [internalUserId, name || '', phone || '', profilePicUrl]);
    } else {
      await pool.query(`
        UPDATE user_profiles 
        SET full_name = $1, phone = $2, profile_pic = $3
        WHERE user_id = $4
      `, [name || '', phone || '', profilePicUrl, internalUserId]);
    }

    // 🌟 2. อัปเดตตำบล (subdistrict) ลงตาราง addresses 
    if (address_line || province) {
      const checkExist = await pool.query('SELECT id FROM addresses WHERE user_id = $1', [internalUserId]);

      if (checkExist.rows.length > 0) {
        await pool.query(`
          UPDATE addresses 
          SET address_line = $1, district = $2, province = $3, postal_code = $4, subdistrict = $5
          WHERE user_id = $6
        `, [address_line || '', district || '', province || '', postal_code || '', sub_district || '', internalUserId]);
      } else {
        await pool.query(`
          INSERT INTO addresses (user_id, address_line, district, province, postal_code, subdistrict)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [internalUserId, address_line || '', district || '', province || '', postal_code || '', sub_district || '']);
      }
    }

    res.status(200).json({ message: 'อัปเดตข้อมูลสำเร็จ', profilePicUrl });
  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในการอัปเดตข้อมูล' });
  }
});

export default router;