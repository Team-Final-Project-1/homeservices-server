import express from "express";
import technicianProfileServices from "../services/technicianProfileService.mjs";
import protectTechnician from "../middlewares/protectTechnician.mjs";
import pool from "../utils/db.mjs";

const technicianProfileRouter = express.Router();

// TODO: เปลี่ยนเป็น req.user.id หลัง authentication เสร็จ

// GET /api/technician-profile/profile
technicianProfileRouter.get("/profile", protectTechnician, async (req, res) => {
  try {
    const profile = await technicianProfileServices.getTechnicianProfile(
      req.user.id,
    );
    if (!profile) {
      return res.status(404).json({ message: "ไม่พบข้อมูลช่าง" });
    }

    res.status(200).json(profile);
  } catch (error) {
    console.error("Error fetching technician profile:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลช่าง" });
  }
});

// PUT /api/technician-profile/profile
technicianProfileRouter.put("/profile", protectTechnician, async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      phone,
      latitude,
      longitude,
      is_available,
      service_ids,
    } = req.body;

    // Validation: เช็ค field บังคับ
    if (!first_name || !last_name || !phone) {
      return res.status(400).json({ message: "กรุณากรอกข้อมูลให้ครบถ้วน" });
    }

    // service_ids ต้องเป็น array เสมอ ถ้าไม่ส่งมาให้ใช้ array ว่าง
    const normalizedServiceIds = Array.isArray(service_ids) ? service_ids : [];

    const updatedProfile =
      await technicianProfileServices.updateTechnicianProfile(req.user.id, {
        first_name,
        last_name,
        phone,
        latitude,
        longitude,
        is_available,
        service_ids: normalizedServiceIds,
      });

    res.status(200).json({
      message: "อัปเดตโปรไฟล์ช่างเรียบร้อยแล้ว",
      profile: updatedProfile,
    });
  } catch (error) {
    console.error("Error updating technician profile:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูลช่าง" });
  }
});

// PATCH /api/technician-profile/location
technicianProfileRouter.patch(
  "/location",
  protectTechnician,
  async (req, res) => {
    const { latitude, longitude } = req.body;
    if (!latitude || !longitude) {
      return res.status(400).json({ message: "กรุณาส่งตำแหน่งให้ครบถ้วน" });
    }
    await pool.query(
      `UPDATE user_profiles
     SET latitude = $1::numeric,
         longitude = $2::numeric,
         location_updated_at = NOW(),
         updated_at = NOW()
     WHERE user_id = $3`,
      [latitude, longitude, req.user.id],
    );
    res.status(200).json({ message: "อัปเดตตำแหน่งเรียบร้อยแล้ว" });
  },
);

// PATCH /api/technician-profile/availability
technicianProfileRouter.patch(
  "/availability",
  protectTechnician,
  async (req, res) => {
    const { is_available } = req.body;
    if (typeof is_available !== "boolean") {
      return res.status(400).json({ message: "กรุณาส่งสถานะให้ถูกต้อง" });
    }
    await pool.query(
      `UPDATE user_profiles SET is_available = $1, updated_at = NOW()
       WHERE user_id = $2`,
      [is_available, req.user.id],
    );
    res.status(200).json({ message: "อัปเดตสถานะเรียบร้อยแล้ว" });
  },
);

export default technicianProfileRouter;
