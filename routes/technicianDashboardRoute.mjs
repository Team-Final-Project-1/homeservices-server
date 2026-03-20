import express from "express";
import protectTechnician from "../middlewares/protectTechnician.mjs";
import { getTechnicianDashboard } from "../services/technicianDashboardService.mjs";

const router = express.Router();

// GET /api/technician-dashboard
router.get("/", protectTechnician, async (req, res) => {
  try {
    const technicianId = req.user.id;
    const dashboard = await getTechnicianDashboard(technicianId);
    res.status(200).json(dashboard);
  } catch (error) {
    console.error("Error fetching technician dashboard:", error);
    res.status(500).json({ message: "Internal Server Error" });
  }
});

export default router;

