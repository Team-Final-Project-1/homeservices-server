import express from "express";
import technicianOrderService from "../services/technicianOrderService.mjs";
import protectTechnician from "../middlewares/protectTechnician.mjs";

const technicianOrderRouter = express.Router();

technicianOrderRouter.get(
  "/orders/available",
  protectTechnician,
  async (req, res) => {
    try {
      const orders = await technicianOrderService.getAvailableOrders(
        req.user.id,
      );
      res.status(200).json(orders);
    } catch (error) {
      console.error("Error fetching available orders:", error);
      res.status(500).json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูล" });
    }
  },
);

technicianOrderRouter.post(
  "/orders/:orderId/accept",
  protectTechnician,
  async (req, res) => {
    try {
      const { orderId } = req.params;

      const result = await technicianOrderService.acceptOrder(
        Number(orderId),
        req.user.id,
      );

      if (!result.success) {
        return res.status(409).json({ message: result.message });
      }

      // =========================================
      // REALTIME: Notify customer that order is accepted
      // =========================================
      try {
        const io = req.app.get("io");
        if (io) {
          // ส่งแบบ Global เพื่อให้ลูกค้าที่รออยู่ได้รับข่าว แม้จะยังไม่ได้เข้า Room
          io.emit("order_accepted", { orderId: String(orderId) });
        }
      } catch (err) {
        console.error("❌ Socket error in accept order:", err);
      }
      // =========================================

      res.status(200).json({ message: result.message });
    } catch (error) {
      console.error("Error accepting order:", error);
      res.status(500).json({ message: "เกิดข้อผิดพลาดในการรับงาน" });
    }
  },
);

technicianOrderRouter.post(
  "/orders/:orderId/reject",
  protectTechnician,
  async (req, res) => {
    try {
      const { orderId } = req.params;

      const result = await technicianOrderService.rejectOrder(
        Number(orderId),
        req.user.id,
      );

      res.status(200).json({ message: result.message });
    } catch (error) {
      console.error("Error rejecting order:", error);
      res.status(500).json({ message: "เกิดข้อผิดพลาดในการปฏิเสธงาน" });
    }
  },
);

export default technicianOrderRouter;
