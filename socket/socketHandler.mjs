import { sendMessage, validateChatAccess } from "../services/chatService.mjs"
import pool from "../utils/db.mjs"

export const initSocket = (io) => {

  const onlineUsers = new Map()

  io.on("connection", (socket) => {

    console.log("🔌 Connected:", socket.id)

    // =============================
    // USER ONLINE
    // =============================
    socket.on("user_online", ({ userId }) => {

      if (!userId) return

      if (!onlineUsers.has(String(userId))) {
        onlineUsers.set(String(userId), new Set())
      }

      onlineUsers.get(String(userId)).add(socket.id)

      console.log("🟢 user online:", userId)

      io.emit("online_users", Array.from(onlineUsers.keys()))
    })


    // =============================
    // JOIN CHAT
    // =============================
    socket.on("join_chat", async ({ order_id, user_id }) => {

      try {

        if (!order_id || !user_id) return

        await validateChatAccess(order_id, user_id)

        socket.join(String(order_id))

        socket.emit("joined_chat", {
          order_id: String(order_id)
        })

      } catch (err) {
        socket.emit("error", err.message)
      }
    })


    // =============================
    // SEND MESSAGE
    // =============================
    socket.on("send_message", async (data) => {

      const { order_id, sender_id, message, image } = data

      try {

        if (!order_id || !sender_id) return
        if (!message && !image) return

        const savedMessage = await sendMessage({
          order_id,
          sender_id,
          message: message?.trim() || null,
          image: image || null
        })

        // =====================================
        // map UUID → INT
        // =====================================
        const { rows } = await pool.query(`
          SELECT id
          FROM users
          WHERE auth_user_id = $1
        `, [savedMessage.sender_id])

        const senderIdInt = rows[0]?.id

        const mappedMessage = {
          ...savedMessage,
          sender_id: String(senderIdInt) // 🔥 สำคัญมาก
        }

        console.log("📤 emit message:", mappedMessage)

        io.to(String(order_id)).emit("receive_message", mappedMessage)

      } catch (err) {
        console.log("❌ send_message error:", err.message)
        socket.emit("error", err.message)
      }
    })


    // =============================
    // TYPING
    // =============================
    socket.on("typing", ({ orderId, userId }) => {
      socket.to(String(orderId)).emit("typing", userId)
    })

    socket.on("stop_typing", ({ orderId }) => {
      socket.to(String(orderId)).emit("stop_typing")
    })


    // =============================
    // CLOSE CHAT
    // =============================
    socket.on("close_room", (orderId) => {
      io.to(String(orderId)).emit("chat_closed")
    })


    // =============================
    // LEAVE
    // =============================
    socket.on("leave_chat", ({ order_id, user_id }) => {
      socket.leave(String(order_id))
    })


    // =============================
    // DISCONNECT
    // =============================
    socket.on("disconnect", () => {

      for (const [userId, sockets] of onlineUsers.entries()) {

        sockets.delete(socket.id)

        if (sockets.size === 0) {
          onlineUsers.delete(userId)
        }
      }

      io.emit("online_users", Array.from(onlineUsers.keys()))
    })

  })
}