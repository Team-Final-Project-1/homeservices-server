import pool from "../utils/db.mjs";

const technicianProfileServices = {
  getTechnicianProfile: async (technicianId) => {
    // Query 1: get technician profile
    const profileResult = await pool.query(
      `
        SELECT u.id,
        u.first_name,
        u.last_name,
        u.phone,
        up.is_available,
        up.latitude,
        up.longitude,
        up.location_updated_at
        FROM users u
        LEFT JOIN user_profiles up ON u.id = up.user_id
        WHERE u.id = $1 AND u.role = 'technician'
    `,
      [technicianId],
    );

    // if no technician found, return null
    if (profileResult.rows.length === 0) {
      return null;
    }
    const technicianData = profileResult.rows[0];

    // Query 2: ดึง services ทั้งหมด พร้อมบอกว่าช่างคนนี้รับได้มั้ย
    // LEFT JOIN technician_services → ถ้าไม่มี record → is_selected = false
    // CASE WHEN → แปลง NULL/NOT NULL เป็น true/false
    const servicesResult = await pool.query(
      `SELECT 
        s.id, 
        s.name, 
        CASE 
            WHEN ts.technician_id IS NOT NULL THEN true 
            ELSE false 
        END AS is_selected
        FROM services s
        LEFT JOIN technician_services ts 
        ON s.id = ts.service_id AND ts.technician_id = $1 
        ORDER BY s.id
        `,
      [technicianId],
    );

    // Combine the results into a single object
    return {
      ...technicianData,
      services: servicesResult.rows,
    };
  },
  updateTechnicianProfile: async (technicianId, data) => {
    // Destructure the input data for easier access and to ensure we only use the expected fields
    const {
      first_name,
      last_name,
      phone,
      is_available,
      latitude,
      longitude,
      service_ids, // array of service IDs that the technician can perform
    } = data;

    // Query 1: update users table
    await pool.query(
      `UPDATE users
        SET first_name = $1,
            last_name = $2,
            full_name = $1 || ' ' || $2,
            phone = $3,
            updated_at = NOW()
        WHERE id = $4 AND role = 'technician'`,
      [first_name, last_name, phone, technicianId],
    );

    // Query 2: update user_profiles table
    // location_updated_at อัปเดตเฉพาะตอนที่ส่ง latitude มาด้วย (กดปุ่มรีเฟรช)
    await pool.query(
      `INSERT INTO user_profiles (user_id, is_available, latitude, longitude, location_updated_at)
        VALUES ($4, $1, $2::numeric, $3::numeric, CASE WHEN $2 IS NOT NULL THEN NOW() ELSE NULL END)
        ON CONFLICT (user_id) DO UPDATE
        SET
        is_available = EXCLUDED.is_available,
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        location_updated_at = CASE
       WHEN EXCLUDED.latitude IS NOT NULL THEN NOW()
       ELSE user_profiles.location_updated_at
     END,
     updated_at = NOW()`,
      [is_available, latitude ?? null, longitude ?? null, technicianId],
    );

    // --- Query 3: อัปเดต technician_services ด้วย Delete + Insert ---
    // ลบทุก service ของช่างคนนี้ก่อน แล้ว insert ใหม่ทั้งหมด
    await pool.query(
      `DELETE FROM technician_services WHERE technician_id = $1`,
      [technicianId],
    );

    // Insert เฉพาะตอนที่มี service_ids ส่งมา ถ้า array ว่างก็ข้ามไป
    if (service_ids && service_ids.length > 0) {
      // สร้าง placeholders เช่น ($1, $2), ($1, $3), ($1, $4)
      // $1 คือ technicianId ที่ใช้ร่วมกัน
      // index + 2 เพราะ $1 ถูกใช้โดย technicianId แล้ว
      const placeholders = service_ids
        .map((_, index) => `($1, $${index + 2})`)
        .join(", ");

      await pool.query(
        `INSERT INTO technician_services (technician_id, service_id) VALUES ${placeholders}`,
        [technicianId, ...service_ids], // ส่ง technicianId ตามด้วย service_ids เป็น parameters
      );
    }
    return technicianProfileServices.getTechnicianProfile(technicianId); // ส่งกลับข้อมูลโปรไฟล์ที่อัปเดตแล้ว
  },
};

export default technicianProfileServices;

//Tips: ที่มีการ query หลายๆตัวใน updateTechnicianProfile เรียกหลักการนี้ว่า "Database Normalization" คือการแยกข้อมูลออกเป็นหลายๆตารางตามประเภทของข้อมูล เพื่อให้จัดการและอัปเดตได้ง่ายขึ้น โดยไม่ต้องซ้ำซ้อนข้อมูลในหลายๆที่
