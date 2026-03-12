import { createClient } from '@supabase/supabase-js';

// สร้าง Supabase client ด้วย URL และ SERVICE ROLE KEY จาก environment variables เพื่อเชื่อมต่อกับ Supabase Admin API
// เราจะใช้ Supabase Admin API สำหรับการจัดการผู้ใช้และการตรวจสอบสิทธิ์ในระดับที่สูงขึ้น เช่น การลบผู้ใช้หรือการอัปเดตข้อมูลผู้ใช้

export const getSupabase = () => {
  if (!supabase) {
    supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );
  }

  return supabase;
};
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
