import express from "express";

const technicianOrderRoute = express.Router();

// TODO: เปลี่ยนเป็น req.user.id หลัง authentication เสร็จ
const TEMP_TECHNICIAN_ID = 34;

// GET /api/technician/orders/available
// ดึงรายการงานที่ยังไม่มีช่างรับ

