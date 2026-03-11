import experss from "express";
import cors from "cors";
import "dotenv/config";
import ServiceRoute from "./routes/serviceRoute.mjs";
import categoryRoute from "./routes/categoryRoute.mjs";
import paymentGateway, { stripeWebhookHandler } from "./routes/paymentGateway.mjs";
import geocodeRoute from "./routes/geocodeRoute.mjs";

const app = experss();
const PORT = process.env.PORT || 4000;

// Stripe webhook needs raw body for signature verification (must be before express.json())
app.post(
  "/api/payment/webhook",
  experss.raw({ type: "application/json" }),
  stripeWebhookHandler
);

app.use(experss.json());
app.use(
  cors({
    origin: [
      "http://localhost:5173", // Frontend local (Vite)
      "http://localhost:3000", // Frontend local (React แบบอื่น)// Frontend ที่ Deploy แล้ว
      "https://homeservices-frontend-gold.vercel.app",
      // ✅ ให้เปลี่ยน https://your-frontend.vercel.app เป็น URL จริงของ Frontend ที่ deploy แล้ว
    ],
  }),
);

app.use("/api/services", ServiceRoute);
app.use("/api/categories", categoryRoute);
app.use("/api/payment", paymentGateway);
app.use("/api/geocode", geocodeRoute);


app.get("/test", (req, res) => {
  res.status(200).json({ message: "Hello World!" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
