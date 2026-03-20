import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
);

// ใช้สำหรับ endpoint ที่ทุก role เข้าได้ (user, technician, admin)
// ตรวจแค่ว่า token valid เท่านั้น ไม่เช็ค role
const protectAuth = async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
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
    console.error("Error in protectAuth middleware:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

export default protectAuth;
