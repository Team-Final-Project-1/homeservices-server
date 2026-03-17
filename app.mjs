// ======================================================
// IMPORTS
// ======================================================

import express from "express"
import cors from "cors"
import "dotenv/config"

import http from "http"
import { Server } from "socket.io"

// utils
import { startChatCleanup } from "./utils/chatCleanup.mjs"

// socket
import { initSocket } from "./socket/socketHandler.mjs"

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
// SOCKET.IO
// ======================================================

const io = new Server(server, {
  cors: {
    origin: "*"
  }
})

initSocket(io)


// ======================================================
// STRIPE WEBHOOK (ต้องอยู่ก่อน json)
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

// ✅ chat
app.use("/api/chat", chatRoute)
app.use("/api/chat", messagesRoute)

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