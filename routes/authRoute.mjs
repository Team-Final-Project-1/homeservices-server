import express from "express";
import {
  registerUser,
  googleOAuth,
  facebookOAuth
} from "../services/authService.mjs";

const router = express.Router();

router.post("/register", registerUser);

// ✅ OAuth routes
router.get("/oauth/google", googleOAuth);
router.get("/oauth/facebook", facebookOAuth);

export default router;