import express from "express";
import pool from "../utils/db.mjs";
import * as technicianHistoryService from "../services/technicianHistoryService.mjs";
import protectTechnician from "../middlewares/protectTechnician.mjs";

const technicianHistoryRouter = express.Router();

// GET /api/technician/history - ดึงประวัติการทำงานทั้งหมด
// TODO: เปลี่ยนจาก params หรือ mock เป็น req.user.id หลังทำ Auth
technicianHistoryRouter.get("/history", protectTechnician, async (req, res) => {
  try {
    const { technicianId } = req.query; // หรือรับจาก Token
    if (!technicianId) {
        return res.status(400).json({ message: "Missing technicianId" });
    }
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
