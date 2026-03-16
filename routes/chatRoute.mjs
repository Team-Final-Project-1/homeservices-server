import express from "express"
import pool from "../utils/db.mjs"

const router = express.Router()

// =====================================
// GET CHAT USERS (customer + technician)
// =====================================

router.get("/:orderId/chat-info", async (req, res) => {

  try {

    const { orderId } = req.params

    // ============================
    // VALIDATE ORDER ID
    // ============================

    if (!orderId) {
      return res.status(400).json({
        error: "orderId is required"
      })
    }

    const query = `
      SELECT
        o.id AS order_id,

        c.id AS customer_id,
        cp.full_name AS customer_name,
        cp.avatar_url AS customer_avatar,

        t.id AS technician_id,
        tp.full_name AS technician_name,
        tp.avatar_url AS technician_avatar

      FROM orders o

      LEFT JOIN users c
        ON o.user_id = c.id

      LEFT JOIN user_profiles cp
        ON c.id = cp.user_id

      LEFT JOIN technician_assignments ta
        ON o.id = ta.order_id

      LEFT JOIN users t
        ON ta.technician_id = t.id

      LEFT JOIN user_profiles tp
        ON t.id = tp.user_id

      WHERE o.id = $1
      LIMIT 1
    `

    const { rows } = await pool.query(query, [orderId])

    // ============================
    // ORDER NOT FOUND
    // ============================

    if (!rows || rows.length === 0) {

      console.log("⚠️ Chat test fallback (order not found):", orderId)

      // fallback สำหรับ dev test (/chat-test)
      return res.json({
        customer: {
          id: "22222222-2222-2222-2222-222222222222",
          name: "Test Customer",
          avatar: null
        },
        technician: {
          id: "a8df9bde-b3e6-45aa-80af-5fb7271cae73",
          name: "Test Technician",
          avatar: null
        }
      })

    }

    const row = rows[0]

    // ============================
    // CUSTOMER OBJECT
    // ============================

    const customer = {
      id: row.customer_id ? String(row.customer_id) : null,
      name: row.customer_name || "Customer",
      avatar: row.customer_avatar || null
    }

    // ============================
    // TECHNICIAN OBJECT
    // ============================

    const technician = row.technician_id
      ? {
          id: String(row.technician_id),
          name: row.technician_name || "Technician",
          avatar: row.technician_avatar || null
        }
      : null

    // ============================
    // RESPONSE
    // ============================

    res.json({
      customer,
      technician
    })

  } catch (err) {

    console.error("❌ Chat info error:", err)

    res.status(500).json({
      error: "Failed to load chat info"
    })

  }

})

export default router