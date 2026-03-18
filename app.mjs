import express from "express";
import cors from "cors";
import "dotenv/config";
import ServiceRoute from "./routes/serviceRoute.mjs";
import categoryRoute from "./routes/categoryRoute.mjs";
import paymentGateway, {
  stripeWebhookHandler,
} from "./routes/paymentGateway.mjs";
import geocodeRoute from "./routes/geocodeRoute.mjs";
import technicianProfileRoute from "./routes/technicianProfileRoute.mjs";
import authRoute from "./routes/authRoute.mjs";
import technicianHistoryRoute from "./routes/technicianHistoryRoute.mjs";
import orderRoute from "./routes/orderRoute.mjs";
import promotionRouter from "./routes/promotionRoute.mjs";
import cartRoute from "./routes/cartRoute.mjs";
import technicianOrderRoute from "./routes/technicianOrderRoute.mjs";
import technicianPendingRoute from "./routes/technicianPendingRoute.mjs";
import notificationRoute from "./routes/notificationRoute.mjs";

import userRoute from "./routes/userRoute.mjs";

const app = express();
const PORT = process.env.PORT || 4000;

//STRIPE WEBHOOK
app.post(
  "/api/payment/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler,
);

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

//TEST ROUTE
app.get("/test", (req, res) => {
  res.status(200).json({ message: "Hello World!" });
});

//START SERVER
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
