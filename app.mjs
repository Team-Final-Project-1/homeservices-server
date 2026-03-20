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
import technicianPendingRoute from "./routes/technicianPendingRoute.mjs";
import notificationRoute from "./routes/notificationRoute.mjs";
import technicianDashboardRoute from "./routes/technicianDashboardRoute.mjs";
import userRoute from "./routes/userRoute.mjs";


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

app.set("io", io)

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

app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:3001",
      "https://homeservices-frontend-gold.vercel.app",
    ],
    credentials: true,
  }),
);

//API ROUTES

app.use("/api/services", ServiceRoute);
app.use("/api/categories", categoryRoute);
app.use("/api/payment", paymentGateway);
app.use("/api/geocode", geocodeRoute);
app.use("/api/auth", authRoute);
app.use("/api/orders", orderRoute);
app.use("/api/cart", cartRoute);
app.use("/api/promotions", promotionRouter);
app.use("/api/users", userRoute);
app.use("/api/notifications", notificationRoute);
app.use("/api/technician-profile", technicianProfileRoute);
app.use("/api/technician-orders", technicianOrderRoute);
app.use("/api/technician", technicianHistoryRoute);
app.use("/api/technician", technicianPendingRoute);
app.use("/api/technician-dashboard", technicianDashboardRoute);
app.use("/api/chat", chatRoute);
app.use("/api/chat", messagesRoute);



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