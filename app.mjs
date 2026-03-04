import "dotenv/config";
import express from "express";
import cors from "cors";
import ServiceRoute from "./routes/serviceRoute.mjs";
import categoryRoute from "./routes/categoryRoute.mjs";
import authRoute from "./routes/authRoute.mjs";
import OrderRoute from "./routes/orderRoute.mjs";
import technicianRoute from "./routes/technicianRoute.mjs";

const app = express();
const PORT = process.env.PORT || 4000;
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://localhost:3000",
      "http://localhost:3001",
      "https://homeservices-frontend-gold.vercel.app",
    ],
  }),
);

app.use("/api/services", ServiceRoute);
app.use("/api/categories", categoryRoute);
app.use("/api/auth", authRoute);
app.use("/api/orders", OrderRoute);
app.use("/api/technician", technicianRoute);
app.get("/test", (req, res) => {
  res.status(200).json({ message: "Hello World!" });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
