import express from "express";
import pool from "../utils/db.mjs";
import protectUser from "../middlewares/protectUser.mjs";

const notificationRoute = express.Router();

// GET /api/notifications - Get all notifications for the authenticated user
notificationRoute.get("/", protectUser, async (req, res) => {
  try {
    const userId = req.user.id; // DB integer id (resolved by protectUser)
    const { rows } = await pool.query(
      `SELECT id, order_id, type, message, is_read, created_at
       FROM notifications
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId],
    );
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// PATCH /api/notifications/read-all - Mark all notifications as read for the authenticated user
notificationRoute.patch("/read-all", protectUser, async (req, res) => {
  try {
    const userId = req.user.id; // DB integer id (resolved by protectUser)
    await pool.query(
      `UPDATE notifications SET is_read = TRUE
       WHERE user_id = $1 AND is_read = FALSE`,
      [userId],
    );
    res.json({ message: "อัปเดตเรียบร้อยแล้ว" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

export default notificationRoute;
