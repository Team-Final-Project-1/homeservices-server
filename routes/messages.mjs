import express from "express"
import {
  sendMessage,
  getMessages,
  markAsRead,
  getUnreadCount
} from "../services/chatService.mjs"

const router = express.Router()

// =============================
// SEND MESSAGE
// =============================
router.post("/", async (req, res) => {
  try {

    const { order_id, sender_id, message, image } = req.body


    if (!order_id || !sender_id || (!message?.trim() && !image)) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    if (message && message.length > 2000) {
      return res.status(400).json({ error: "Message too long" })
    }

    const data = await sendMessage({
      order_id,
      sender_id,
      message: message?.trim() || null,
      image: image || null
    })

    const io = req.app.get("io")
    if (io) {
      io.to(String(order_id)).emit("receive_message", data)
    }

    res.json(data)

  } catch (err) {
    console.error("❌ SEND ERROR:", err)
    res.status(500).json({ error: err.message })
  }
})


// =============================
// LOAD CHAT
// =============================
router.get("/messages/:orderId", async (req, res) => {
  try {

    const { orderId } = req.params
    const { userId } = req.query


    let page = parseInt(req.query.page)
    if (!page || page < 1) page = 1

    const data = await getMessages(orderId, userId, page)

    res.json(data)

  } catch (err) {
    console.error("❌ LOAD ERROR:", err)
    res.status(500).json({ error: err.message })
  }
})


// =============================
// MARK READ
// =============================
router.put("/messages/read/:orderId", async (req, res) => {
  try {

    const { orderId } = req.params
    const { userId } = req.body


    if (!userId) {
      return res.status(400).json({ error: "userId required" })
    }

    await markAsRead(orderId, userId)

    res.json({ success: true })

  } catch (err) {
    console.error("❌ READ ERROR:", err)
    res.status(500).json({ error: err.message })
  }
})


// =============================
// UNREAD COUNT
// =============================
router.get("/messages/unread/:orderId/:userId", async (req, res) => {
  try {

    const { orderId, userId } = req.params

    const count = await getUnreadCount(orderId, userId)

    res.json({ count })

  } catch (err) {
    console.error("❌ UNREAD ERROR:", err)
    res.status(500).json({ error: err.message })
  }
})

export default router