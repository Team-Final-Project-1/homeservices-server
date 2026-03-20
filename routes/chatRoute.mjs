import express from "express"
import pool from "../utils/db.mjs"

const router = express.Router()

router.get("/:orderId/chat-info", async (req, res) => {
  try {
    const { orderId } = req.params


    if (!orderId) {
      return res.status(400).json({ error: "orderId is required" })
    }

    if (!/^\d+$/.test(orderId)) {
      return res.status(400).json({ error: "Invalid orderId" })
    }

    const query = `
      SELECT
        o.id AS order_id,

        c.id AS customer_id,
        c.full_name AS customer_name,

        ta.technician_id,
        t.full_name AS technician_name

      FROM orders o

      LEFT JOIN users c 
        ON o.user_id = c.id

      --  ใช้ assignment แทน
      LEFT JOIN LATERAL (
        SELECT *
        FROM technician_assignments ta
        WHERE ta.order_id = o.id
        ORDER BY ta.id DESC
        LIMIT 1
      ) ta ON true

      LEFT JOIN users t 
        ON ta.technician_id = t.id

      WHERE o.id = $1
      LIMIT 1
    `

    const { rows } = await pool.query(query, [Number(orderId)])

    if (!rows.length) {
      console.log("❌ order not found:", orderId)
      console.log("❌ order not found:", orderId)
      return res.status(404).json({ error: "Order not found" })
    }

    const row = rows[0]
    console.log("📡 chat-info result:", {
      orderId,
      customer_id: row.customer_id,
      technician_id: row.technician_id
    })


    console.log("📡 chat-info result:", {
      orderId,
      customer_id: row.customer_id,
      technician_id: row.technician_id
    })

    res.json({
      customer: {
        id: row.customer_id ? String(row.customer_id) : null,
        name: row.customer_name || "Customer"
      },
      technician: row.technician_id
        ? {
            id: String(row.technician_id),
            name: row.technician_name || "Technician"
          }
        : null
    })

  } catch (err) {
    console.error("❌ Chat info error:", err)
    res.status(500).json({ error: "Failed to load chat info" })
  }
})

export default router