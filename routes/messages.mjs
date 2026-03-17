import express from "express"
import { randomUUID } from "crypto"
import { getSupabase } from "../utils/supabaseClient.mjs"
import { requireChatAccess } from "../middlewares/chatAuth.mjs"

const router = express.Router()

// =============================
// SEND TEXT MESSAGE
// =============================
router.post("/messages", requireChatAccess, async (req, res) => {

  try {

    const { order_id, sender_id, message } = req.body

    if (!order_id || !sender_id || !message || message.trim() === "") {
      return res.status(400).json({ error: "Missing required fields" })
    }

    if (message.length > 2000) {
      return res.status(400).json({ error: "Message too long" })
    }

    const supabase = getSupabase()

    const id = randomUUID()

    const { data, error } = await supabase
      .from("messages")
      .insert([
        {
          id,
          order_id,
          sender_id,
          message: message.trim(),
          is_read: false
        }
      ])
      .select()

    if (error) {
      console.error("❌ INSERT ERROR:", error)
      return res.status(400).json(error)
    }

    res.json(data[0])

  } catch (err) {
    console.error("❌ SERVER ERROR:", err)
    res.status(500).json({ error: "Send message failed" })
  }

})


// =============================
// SEND IMAGE MESSAGE
// =============================
router.post("/messages/image", requireChatAccess, async (req, res) => {

  try {

    const { order_id, sender_id, image } = req.body

    if (!order_id || !sender_id || !image) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    const supabase = getSupabase()

    const id = randomUUID()

    const { data, error } = await supabase
      .from("messages")
      .insert([
        {
          id,
          order_id,
          sender_id,
          image,
          is_read: false
        }
      ])
      .select()

    if (error) {
      console.error("❌ IMAGE INSERT ERROR:", error)
      return res.status(400).json(error)
    }

    res.json(data[0])

  } catch (err) {
    console.error("❌ SERVER ERROR:", err)
    res.status(500).json({ error: "Send image failed" })
  }

})


// =============================
// LOAD CHAT HISTORY
// =============================
router.get("/messages/:orderId", requireChatAccess, async (req, res) => {

  try {

    const { orderId } = req.params

    let page = parseInt(req.query.page)
    if (!page || page < 1) page = 1

    const limit = 30
    const from = (page - 1) * limit
    const to = from + limit - 1

    const supabase = getSupabase()

    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true })
      .range(from, to)

    if (error) {
      console.error("❌ LOAD ERROR:", error)
      return res.status(400).json(error)
    }

    res.json(data)

  } catch (err) {
    console.error("❌ SERVER ERROR:", err)
    res.status(500).json({ error: "Load messages failed" })
  }

})


// =============================
// MARK MESSAGE AS READ
// =============================
router.put("/messages/read/:orderId", requireChatAccess, async (req, res) => {

  try {

    const { orderId } = req.params
    const { userId } = req.body

    if (!userId) {
      return res.status(400).json({
        error: "userId required"
      })
    }

    const supabase = getSupabase()

    const { error } = await supabase
      .from("messages")
      .update({ is_read: true })
      .eq("order_id", orderId)
      .neq("sender_id", userId)

    if (error) {
      console.error("❌ UPDATE ERROR:", error)
      return res.status(400).json(error)
    }

    res.json({ success: true })

  } catch (err) {
    console.error("❌ SERVER ERROR:", err)
    res.status(500).json({
      error: "Update read status failed"
    })
  }

})


// =============================
// DELETE CHAT (OPTIONAL)
// =============================
router.delete("/messages/order/:orderId", async (req, res) => {

  try {

    const { orderId } = req.params

    if (!orderId) {
      return res.status(400).json({ error: "orderId required" })
    }

    const supabase = getSupabase()

    const { error } = await supabase
      .from("messages")
      .delete()
      .eq("order_id", orderId)

    if (error) {
      console.error("❌ DELETE ERROR:", error)
      return res.status(400).json(error)
    }

    res.json({ success: true })

  } catch (err) {
    console.error("❌ SERVER ERROR:", err)
    res.status(500).json({
      error: "Delete chat failed"
    })
  }

})


// =============================
// GET UNREAD COUNT
// =============================
router.get("/messages/unread/:orderId/:userId", requireChatAccess, async (req, res) => {

  try {

    const { orderId, userId } = req.params

    const supabase = getSupabase()

    const { data, error } = await supabase
      .from("messages")
      .select("id")
      .eq("order_id", orderId)
      .eq("is_read", false)
      .neq("sender_id", userId)

    if (error) {
      return res.status(400).json(error)
    }

    res.json({
      count: data.length
    })

  } catch (err) {
    console.error(err)
    res.status(500).json({
      error: "Unread count failed"
    })
  }

})

export default router