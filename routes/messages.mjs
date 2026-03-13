import express from "express"
import { supabaseAdmin } from "../utils/supabaseAdmin.mjs"

const router = express.Router()

// =============================
// SEND MESSAGE
// =============================

router.post("/messages", async (req, res) => {

  try {

    const { order_id, sender_id, message } = req.body

    // validation
    if (!order_id || !sender_id || !message) {
      return res.status(400).json({
        error: "Missing required fields"
      })
    }

    const { data, error } = await supabaseAdmin
      .from("messages")
      .insert([
        {
          order_id,
          sender_id,
          message
        }
      ])
      .select()

    if (error) {
      return res.status(400).json(error)
    }

    res.json(data)

  } catch (err) {

    res.status(500).json({
      error: "Send message failed"
    })

  }

})


// =============================
// LOAD CHAT HISTORY
// =============================

router.get("/messages/:orderId", async (req, res) => {

  try {

    const { orderId } = req.params

    const { data, error } = await supabaseAdmin
      .from("messages")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })

    if (error) {
      return res.status(400).json(error)
    }

    res.json(data)

  } catch (err) {

    res.status(500).json({
      error: "Load messages failed"
    })

  }

})


// =============================
// MARK MESSAGE AS READ
// =============================

router.put("/messages/read/:orderId", async (req, res) => {

  try {

    const { orderId } = req.params
    const { userId } = req.body

    if (!userId) {
      return res.status(400).json({
        error: "userId is required"
      })
    }

    const { data, error } = await supabaseAdmin
      .from("messages")
      .update({ is_read: true })
      .eq("order_id", orderId)
      .neq("sender_id", userId)

    if (error) {
      return res.status(400).json(error)
    }

    res.json({
      success: true
    })

  } catch (err) {

    res.status(500).json({
      error: "Update read status failed"
    })

  }

})

export default router