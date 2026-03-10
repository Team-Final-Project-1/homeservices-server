import express from "express";
import technicianProfileServices from "../services/technicianProfileService.mjs";
import protectTechnician from "../middlewares/protectTechnician.mjs";

const technicianProfileRouter = express.Router();

// TODO: เปลี่ยนเป็น req.user.id หลัง authentication เสร็จ
const TEMP_TECHNICIAN_ID = 34;

// GET /api/technician/profile
technicianProfileRouter.get("/profile", async (req, res) => {
  try {
    const profile =
      await technicianProfileServices.getTechnicianProfile(TEMP_TECHNICIAN_ID);
    if (!profile) {
      return res.status(404).json({ message: "ไม่พบข้อมูลช่าง" });
    }

    res.status(200).json(profile);
  } catch (error) {
    console.error("Error fetching technician profile:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลช่าง" });
  }
});

// PUT /api/technician/profile
technicianProfileRouter.put("/profile", async (req, res) => {
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

    const updatedProfile = await technicianProfileServices.updateTechnicianProfile(
      TEMP_TECHNICIAN_ID,
      {
        first_name,
        last_name,
        phone,
        latitude,
        longitude,
        is_available,
        service_ids: normalizedServiceIds,
      },
    );

    res.status(200).json({
      message: "อัปเดตโปรไฟล์ช่างเรียบร้อยแล้ว",
      profile: updatedProfile,
    });
  } catch (error) {
    console.error("Error updating technician profile:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการอัปเดตข้อมูลช่าง" });
  }
});

export default technicianProfileRouter;
