import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);
const protectUser = async (req, res, next) => {
  // สำคัญมากคือ ต้องตรวจสอบว่า token ถูกส่งมาหรือไม่ ต้องใช้ ? เพื่อป้องกัน error กรณีที่ header ไม่มี authorization
  // หากไม่ใส่ ? แล้ว header ไม่มี authorization จะทำให้เกิด error ทันที
  const token = req.headers.authorization?.split(" ")[1]; // **ดึง token จาก Authorization header**
  if (!token) {
    return res.status(401).json({ error: "Unauthorized: Token missing" });
  }
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: "Unauthorized: Invalid token" });
    }
    req.user = { ...data.user };
    next();
  } catch (err) {
    console.error("Error in protectUser middleware:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
export default protectUser;
