import cron from "node-cron"
import { getSupabase } from "./supabaseClient.mjs"

export const startChatCleanup = () => {

  // run every day at 03:00 AM
  cron.schedule("0 3 * * *", async () => {

    try {

      console.log("🧹 Running chat cleanup job...")

      const supabase = getSupabase()

      // ลบเฉพาะ chat ของงานที่ "เสร็จแล้ว"
      const thirtyDaysAgo = new Date()
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

      // ==============================
      //  หา order ที่ completed
      // ==============================

      const { data: orders, error: orderError } = await supabase
        .from("orders")
        .select("id")
        .eq("service_status", "completed")

      if (orderError) {
        console.error("❌ Fetch orders error:", orderError)
        return
      }

      if (!orders || orders.length === 0) {
        console.log("ℹ️ No completed orders found")
        return
      }

      const orderIds = orders.map(o => o.id)

      // ==============================
      //  ลบ messages ของ order เหล่านั้น
      // ==============================

      const { error: deleteError } = await supabase
        .from("messages")
        .delete()
        .in("order_id", orderIds)
        .lt("created_at", thirtyDaysAgo.toISOString())

      if (deleteError) {
        console.error("❌ Chat cleanup error:", deleteError)
      } else {
        console.log("✅ Old completed chat deleted")
      }

    } catch (err) {

      console.error("❌ Cleanup crash:", err)

    }

  })

}