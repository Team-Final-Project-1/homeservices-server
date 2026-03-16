// ======================================================
// IMPORTS
// ======================================================

import express from "express"
import cors from "cors"
import "dotenv/config"

import http from "http"
import { Server } from "socket.io"

import { startChatCleanup } from "./utils/chatCleanup.mjs"

// ======================================================
// ROUTES
// ======================================================

import ServiceRoute from "./routes/serviceRoute.mjs"
import categoryRoute from "./routes/categoryRoute.mjs"
import paymentGateway, { stripeWebhookHandler } from "./routes/paymentGateway.mjs"
import geocodeRoute from "./routes/geocodeRoute.mjs"
import technicianProfileRoute from "./routes/technicianProfileRoute.mjs"
import authRoute from "./routes/authRoute.mjs"
import technicianHistoryRoute from "./routes/technicianHistoryRoute.mjs"
import orderRoute from "./routes/orderRoute.mjs"
import promotionRouter from "./routes/promotionRoute.mjs"
import cartRoute from "./routes/cartRoute.mjs"
import technicianOrderRoute from "./routes/technicianOrderRoute.mjs"
import messagesRoute from "./routes/messages.mjs"
import chatRoute from "./routes/chatRoute.mjs"

// ======================================================
// APP INIT
// ======================================================

const app = express()
const PORT = process.env.PORT || 4000

// ======================================================
// HTTP SERVER
// ======================================================

const server = http.createServer(app)

// ======================================================
// SOCKET.IO SERVER
// ======================================================

const io = new Server(server, {
  cors: {
    origin: "*"
  }
})

// ======================================================
// ONLINE USERS STORE
// userId -> socketId
// ======================================================

const onlineUsers = new Map()

// ======================================================
// SOCKET CONNECTION
// ======================================================

io.on("connection", (socket) => {

  console.log("🔌 Socket connected:", socket.id)

  // ==============================================
  // USER ONLINE
  // ==============================================

  socket.on("user_online", ({ userId }) => {

    try {

      if (!userId) return

      const oldSocket = onlineUsers.get(userId)

      if (oldSocket && oldSocket !== socket.id) {
        onlineUsers.delete(userId)
      }

      onlineUsers.set(userId, socket.id)

      console.log("🟢 User online:", userId)

      io.emit(
        "online_users",
        Array.from(onlineUsers.keys()).map(String)
      )

    } catch (err) {

      console.error("online error:", err)

    }

  })

  // ==============================================
  // JOIN ROOM
  // ==============================================

  socket.on("join_room", (orderId) => {

    try {

      if (!orderId) return

      socket.join(orderId)

      console.log(`📦 Joined room ${orderId}`)

    } catch (err) {

      console.error("join room error:", err)

    }

  })

  // ==============================================
  // SEND MESSAGE
  // ==============================================

  socket.on("send_message", (message) => {

    try {

      if (!message?.order_id) return

      console.log("💬 Message:", message)

      io.to(message.order_id).emit("receive_message", message)

    } catch (err) {

      console.error("send message error:", err)

    }

  })

  // ==============================================
  // CLOSE CHAT ROOM
  // ==============================================

  socket.on("close_room", (orderId) => {

    try {

      if (!orderId) return

      console.log("🚪 Closing chat room:", orderId)

      io.to(orderId).emit("chat_closed")

    } catch (err) {

      console.error("close room error:", err)

    }

  })

  // ==============================================
  // TYPING
  // ==============================================

  socket.on("typing", ({ orderId, userId }) => {

    try {

      if (!orderId) return

      socket.to(orderId).emit("typing", { userId })

    } catch (err) {

      console.error("typing error:", err)

    }

  })

  socket.on("stop_typing", ({ orderId }) => {

    try {

      if (!orderId) return

      socket.to(orderId).emit("stop_typing")

    } catch (err) {

      console.error("stop typing error:", err)

    }

  })

  // ==============================================
  // DISCONNECT
  // ==============================================

  socket.on("disconnect", () => {

    console.log("🔴 Socket disconnected:", socket.id)

    try {

      let offlineUser = null

      for (const [userId, socketId] of onlineUsers.entries()) {

        if (socketId === socket.id) {

          offlineUser = userId
          onlineUsers.delete(userId)
          break

        }

      }

      if (offlineUser) {

        console.log("🔴 User offline:", offlineUser)

        io.emit(
          "online_users",
          Array.from(onlineUsers.keys()).map(String)
        )

      }

    } catch (err) {

      console.error("disconnect error:", err)

    }

  })

})

// ======================================================
// STRIPE WEBHOOK
// ======================================================

app.post(
  "/api/payment/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler
)

// ======================================================
// MIDDLEWARE
// ======================================================

app.use(express.json())

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:3001",
      "https://homeservices-frontend-gold.vercel.app"
    ]
  })
)

// ======================================================
// ROUTES
// ======================================================

app.use("/api/services", ServiceRoute)
app.use("/api/categories", categoryRoute)
app.use("/api/payment", paymentGateway)
app.use("/api/geocode", geocodeRoute)
app.use("/api/auth", authRoute)
app.use("/api/orders", orderRoute)
app.use("/api/technician", technicianHistoryRoute)
app.use("/api/promotions", promotionRouter)
app.use("/api/cart", cartRoute)
app.use("/api/technician-profile", technicianProfileRoute)
app.use("/api/technician-orders", technicianOrderRoute)
app.use("/api/chat", chatRoute)

// chat messages API
app.use("/api", messagesRoute)

// ======================================================
// TEST ROUTE
// ======================================================

app.get("/test", (req, res) => {
  res.status(200).json({ message: "Hello World!" })
})

// ======================================================
// START CRON JOB
// ======================================================

startChatCleanup()

// ======================================================
// START SERVER
// ======================================================

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`)
})