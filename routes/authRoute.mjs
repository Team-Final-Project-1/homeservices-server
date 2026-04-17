import express from "express";
import { createClient } from "@supabase/supabase-js";
import pool from "../utils/db.mjs";
import generateUsername from "../utils/generateusername.mjs";
import { supabaseAdmin } from "../utils/supabaseAdmin.mjs";
import protectAuth from "../middlewares/protectAuth.mjs";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const authRouter = express.Router();

authRouter.post("/register", async (req, res) => {
  const { full_name, phone, email, password } = req.body;

  if (
    !full_name?.trim() ||
    !phone?.trim() ||
    !email?.trim() ||
    !password?.trim()
  ) {
    return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบถ้วน" });
  }

  try {
    const { data, error: supabaseError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (supabaseError) {
      if (supabaseError.code === "user_already_exists") {
        return res
          .status(400)
          .json({ error: "User with this email already exists" });
      }
      return res
        .status(400)
        .json({ error: "Failed to create user. Please try again." });
    }

    const supabaseUserId = data.user.id;
    const username = generateUsername(email);

    const query = `
      INSERT INTO users (auth_user_id, full_name, phone, email, username, role)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    const values = [supabaseUserId, full_name, phone, email, username, "user"];

    const { rows } = await pool.query(query, values);
    if (!rows[0]) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(supabaseUserId);
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
      return res.status(500).json({ error: "Failed to create user profile" });
    }

    res.status(201).json({
      message: "User created successfully",
      user: rows[0],
    });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ error: "An error occurred during registration" });
  }
});

authRouter.post("/register/technician", async (req, res) => {
  const { first_name, last_name, phone, email, password } = req.body;

  if (
    !first_name?.trim() ||
    !last_name?.trim() ||
    !phone?.trim() ||
    !email?.trim() ||
    !password?.trim()
  ) {
    return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบถ้วน" });
  }

  const full_name = `${first_name.trim()} ${last_name.trim()}`;

  try {
    const { data, error: supabaseError } = await supabase.auth.signUp({
      email,
      password,
    });

    if (supabaseError) {
      if (supabaseError.code === "user_already_exists") {
        return res
          .status(400)
          .json({ error: "User with this email already exists" });
      }
      return res
        .status(400)
        .json({ error: "Failed to create user. Please try again." });
    }

    const supabaseUserId = data.user.id;
    const username = generateUsername(email);

    const query = `INSERT INTO users (auth_user_id, full_name, first_name, last_name, phone, email, username, role)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *;`;
    const values = [
      supabaseUserId,
      full_name,
      first_name.trim(),
      last_name.trim(),
      phone,
      email,
      username,
      "technician",
    ];

    const { rows } = await pool.query(query, values);
    if (!rows[0]) {
      try {
        await supabaseAdmin.auth.admin.deleteUser(supabaseUserId);
      } catch (rollbackError) {
        console.error("Rollback failed:", rollbackError);
      }
      return res.status(500).json({ error: "Failed to create user profile" });
    }

    res.status(201).json({
      message: "User created successfully",
      user: rows[0],
    });
  } catch (error) {
    console.error("Error during registration:", error);
    res.status(500).json({ error: "An error occurred during registration" });
  }
});

authRouter.post("/login", async (req, res) => {
  const { email, password, expectedRole } = req.body;

  if (!email?.trim() || !password?.trim()) {
    return res.status(400).json({ error: "กรุณากรอกอีเมลและรหัสผ่าน" });
  }
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) {
      if (
        error.code === "invalid_credentials" ||
        error.message.includes("Invalid login credentials")
      ) {
        return res.status(400).json({
          error: "รหัสผ่านหรืออีเมลของท่านไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง",
        });
      }
      return res
        .status(400)
        .json({ error: "ไม่สามารถเข้าสู่ระบบได้ กรุณาลองใหม่อีกครั้ง" });
    }

    if (expectedRole) {
      const { rows } = await pool.query(
        `SELECT role FROM users WHERE auth_user_id = $1 LIMIT 1`,
        [data.user.id],
      );
      const dbRole = rows[0]?.role;
      if (!dbRole || dbRole !== expectedRole) {
        return res.status(403).json({
          error: "บัญชีผู้ใช้ของคุณไม่ได้รับสิทธิ์เข้าใช้งานระบบนี้",
        });
      }
    }

    return res.status(200).json({
      message: "Signed in successfully",
      access_token: data.session.access_token,
    });
  } catch (error) {
    console.error("Error during login:", error);
    return res.status(500).json({ error: "An error occurred during login" });
  }
});

authRouter.get("/get-user", protectAuth, async (req, res) => {
  try {
    const supabaseUserId = req.user.id;
    // Prefer users.profile_pic (updated by POST .../update-profile); fall back to user_profiles / metadata
    const query = `SELECT 
        u.id,
        u.email,
        u.username,
        u.role,
        u.full_name,
        u.phone,
        COALESCE(
          NULLIF(TRIM(COALESCE(u.profile_pic, '')), ''),
          up.profile_pic,
          up.avatar_url
        ) AS profile_pic
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE u.auth_user_id = $1
    `;
    const values = [supabaseUserId];
    const { rows } = await pool.query(query, values);
    if (!rows[0]) {
      return res.status(404).json({ error: "User profile not found" });
    }
    res.status(200).json({
      id: rows[0].id,
      auth_user_id: supabaseUserId,
      email: rows[0].email,
      username: rows[0].username ?? rows[0].email.split("@")[0],
      role: rows[0].role,
      full_name: rows[0].full_name,
      phone: rows[0].phone ?? "",
      profile_pic:
        rows[0].profile_pic ?? req.user.user_metadata?.avatar_url ?? "",
    });
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
  }
});

authRouter.put("/reset-password", protectAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!newPassword) {
    return res.status(400).json({ error: "New password is required" });
  }
  try {
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: req.user.email,
      password: oldPassword,
    });
    if (loginError) {
      return res.status(400).json({ error: "รหัสผ่านเดิมไม่ถูกต้อง" });
    }
    const { error: updateError } =
      await supabaseAdmin.auth.admin.updateUserById(req.user.id, {
        password: newPassword,
      });
    if (updateError) {
      return res.status(400).json({ error: updateError.message });
    }
    res.status(200).json({ message: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว" });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
  }
});

export default authRouter;
