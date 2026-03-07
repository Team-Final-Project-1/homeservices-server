import express from "express";
import { googleOAuth, facebookOAuth } from "../services/authService.mjs";
import { createClient } from "@supabase/supabase-js";
import pool from "../utils/db.mjs";
import generateUsername from "../utils/generateusername.mjs";
import { supabaseAdmin } from "../utils/supabaseAdmin.mjs";

// สร้าง Supabase client ด้วย URL และ ANON KEY จาก environment variables เพื่อเชื่อมต่อกับ Supabase Auth
// เราจะใช้ Supabase Auth สำหรับการจัดการผู้ใช้และการตรวจสอบสิทธิ์ ในขณะที่ข้อมูลผู้ใช้เพิ่มเติมจะถูกเก็บในฐานข้อมูล PostgreSQL ของเรา
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

const authRouter = express.Router();

// Route สำหรับการลงทะเบียนผู้ใช้ (Register)
// ในขั้นตอนการลงทะเบียน เราจะตรวจสอบว่าอีเมลที่ผู้ใช้ส่งมานั้นซ้ำกับผู้ใช้อื่นหรือไม่ หากไม่ซ้ำ เราจะสร้างบัญชีผู้ใช้ใน Supabase Auth
// และเพิ่มข้อมูลผู้ใช้ในตาราง users ของฐานข้อมูล PostgreSQL

authRouter.post("/register", async (req, res) => {
  // ดึงข้อมูลที่ user ส่งมาจาก request body ซึ่งประกอบด้วย name, phone, email, password
  const { full_name, phone, email, password } = req.body;

  // Validate
  if (!full_name || !phone || !email || !password) {
    return res.status(400).json({ error: "กรุณากรอกข้อมูลให้ครบถ้วน" });
  }

  try {
    // เราจะสร้างบัญชีผู้ใช้ใน Supabase Auth ด้วย email และ password ที่ผู้ใช้ส่งมา
    // หากการสร้างบัญชีผู้ใช้ใน Supabase Auth สำเร็จ เราจะได้รับข้อมูลผู้ใช้ใหม่ในตัวแปร data และหากมีข้อผิดพลาดจะถูกเก็บในตัวแปร supabaseError
    const { data, error: supabaseError } = await supabase.auth.signUp({
      email,
      password,
    });

    // หากมีข้อผิดพลาดในการสร้างบัญชีผู้ใช้ในSupabase Auth เราจะตรวจสอบว่าเป็นข้อผิดพลาดที่เกิดจากการที่มีผู้ใช้ที่มี email นี้อยู่แล้วหรือไม่ และส่ง response กลับไปยัง client ตามกรณี
    if (supabaseError) {
      // ตรวจสอบว่า error code เป็น "user_already_exists" หรือไม่ ซึ่งหมายความว่ามีผู้ใช้ที่มี email นี้อยู่แล้วในระบบ
      if (supabaseError.code === "user_already_exists") {
        return res
          .status(400)
          .json({ error: "User with this email already exists" });
      }
      return res
        .status(400)
        .json({ error: "Failed to create user. Please try again." });
    }

    // หากการสร้างบัญชีผู้ใช้ใน Supabase Auth สำเร็จ เราจะได้รับข้อมูลผู้ใช้ใหม่ในตัวแปร data ซึ่งประกอบด้วยข้อมูลต่าง ๆ ของผู้ใช้ รวมถึง id ของผู้ใช้ที่ถูกสร้างขึ้น
    const supabaseUserId = data.user.id;
    const username = generateUsername(email);

    // หลังจากที่เราสร้างบัญชีผู้ใช้ใน Supabase Auth สำเร็จ เราจะเพิ่มข้อมูลผู้ใช้ในตาราง users ของฐานข้อมูล PostgreSQL
    // โดยใช้ id ที่ได้จาก Supabase Auth เป็น primary key และเก็บข้อมูลเพิ่มเติมเช่น full_name, phone, email และ role
    const query = `
      INSERT INTO users (auth_user_id, full_name, phone, email, username, role)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *;
    `;
    // เราจะใช้ parameterized query เพื่อป้องกัน SQL injection โดยการใช้ $1, $2, $3, $4, $5, $6 เป็นตัวแทนของค่าที่จะถูกแทรกเข้าไปใน
    // query และเก็บค่าที่จะถูกแทรกไว้ใน array values
    const values = [supabaseUserId, full_name, phone, email, username, "user"];

    // เราจะใช้ connectionPool.query เพื่อรัน query ที่เราเตรียมไว้ โดยส่ง query และ values เข้าไปเป็นพารามิเตอร์
    // และเก็บผลลัพธ์ที่ได้จากการรัน query ในตัวแปร rows ซึ่งจะเป็น array ของแถวที่ถูกแทรกเข้าไปในตาราง users
    const { rows } = await pool.query(query, values);
    // Rollback Supabase Auth ถ้า INSERT ล้มเหลว
    if (!rows[0]) {
      await supabase.auth.admin.deleteUser(supabaseUserId);
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
// Route สำหรับการเข้าสู่ระบบ (Login)
authRouter.post("/login", async (req, res) => {
  const { email, password } = req.body;
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
          error: "Your password is incorrect or this email does not exist",
        });
      }
      return res.status(400).json({ error: error.message });
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
// Route สำหรับดึงข้อมูลผู้ใช้ที่เข้าสู่ระบบแล้ว
authRouter.get("/get-user", async (req, res) => {
  // แยก token ออกจาก header ของ request โดยคาดว่า token จะถูกส่งมาในรูปแบบ "Bearer <token>" ดังนั้นเราจะใช้ split(" ") เพื่อแยกคำว่า "Bearer" ออกจาก token และดึงเฉพาะ token มาใช้งาน
  const token = req.headers.authorization?.split(" ")[1];
  // หาก token ไม่มีอยู่ใน header เราจะส่ง response กลับไปยัง client ว่าการเข้าถึงถูกปฏิเสธเนื่องจากไม่มี token
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token missing" });
  }
  try {
    // เราจะใช้ token ที่ได้รับมาเพื่อตรวจสอบความถูกต้องและดึงข้อมูลผู้ใช้จาก Supabase Auth โดยใช้ supabase.auth.getUser(token)
    // หาก token ไม่ถูกต้องหรือหมดอายุ เราจะส่ง response กลับไปยัง client ว่าการเข้าถึงถูกปฏิเสธเนื่องจาก token ไม่ถูกต้องหรือหมดอายุ
    const { data, error } = await supabase.auth.getUser(token);
    if (error) {
      return res.status(401).json({ error: "Unauthorized or token expired" });
    }
    const supabaseUserId = data.user.id;
    const query = `SELECT 
        u.id,
        u.email,
        u.username,
        u.role,
        u.full_name,
        u.phone,
        up.avatar_url AS profile_pic
      FROM users u
      LEFT JOIN user_profiles up ON up.user_id = u.id
      WHERE u.auth_user_id = $1
    `;
    const values = [supabaseUserId];
    const { rows } = await pool.query(query, values);
    if (!rows[0]) {
      return res.status(404).json({ error: "User profile not found" });
    }
    console.log("DB rows[0]:", rows[0]);
    res.status(200).json({
      id: data.user.id,
      email: rows[0].email,
      username: rows[0].username,
      role: rows[0].role,
      full_name: rows[0].full_name,
      phone: rows[0].phone,
      profile_pic: rows[0].profile_pic,
    });
  } catch (error) {
    console.error("Error fetching user data:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
  }
});
authRouter.put("/reset-password", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  const { oldPassword, newPassword } = req.body;
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token missing" });
  }
  if (!newPassword) {
    return res.status(400).json({ error: "New password is required" });
  }
  try {
    const { data: userData, error: userError } =
      await supabase.auth.getUser(token);
    if (userError || !userData.user) {
      return res.status(401).json({ error: "Unauthorized or token expired" });
    }
    const { error: loginError } = await supabase.auth.signInWithPassword({
      email: userData.user.email,
      password: oldPassword,
    });
    if (loginError) {
      return res.status(400).json({ error: "รหัสผ่านเดิมไม่ถูกต้อง" });
    }
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      userData.user.id,
      { password: newPassword },
    );
    if (updateError) {
      return res.status(400).json({ error: updateError.message });
    }
    res.status(200).json({ message: "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว" });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ error: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" });
  }
});

// ✅ OAuth routes
authRouter.get("/oauth/google", googleOAuth);
authRouter.get("/oauth/facebook", facebookOAuth);

export default authRouter;
