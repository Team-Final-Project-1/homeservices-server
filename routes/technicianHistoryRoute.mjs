import express from "express";
import * as technicianHistoryService from "../services/technicianHistoryService.mjs";
import protectTechnician from "../middlewares/protectTechnician.mjs";

const technicianHistoryRouter = express.Router();

// GET /api/technician/history - ดึงประวัติการทำงานทั้งหมด
technicianHistoryRouter.get("/history", protectTechnician, async (req, res) => {
  try {
    const technicianId = req.user.id; // ใช้ ID จาก token ที่ผ่าน protectTechnician แล้ว
    const history = await technicianHistoryService.getTechnicianHistory(technicianId);
    res.status(200).json(history);
  } catch (error) {
    console.error("Error fetching technician history:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลประวัติ" });
  }
});

// GET /api/technician/history/:orderId - ดึงรายละเอียดคำสั่งซ่อมรายอัน
technicianHistoryRouter.get("/history/:orderId", protectTechnician, async (req, res) => {
  try {
    const { orderId } = req.params;
    const detail = await technicianHistoryService.getTechnicianHistoryDetail(orderId);
    
    if (!detail) {
      return res.status(404).json({ message: "ไม่พบข้อมูลคำสั่งซ่อมนี้" });
    }

    res.status(200).json(detail);
  } catch (error) {
    console.error("Error fetching history detail:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงรายละเอียด" });
  }
});

export default technicianHistoryRouter;
