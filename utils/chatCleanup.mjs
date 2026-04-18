import cron from "node-cron"
import pool from "./db.mjs"

export const startChatCleanup = () => {

  // ทุกวัน 03:00
  cron.schedule("0 3 * * *", async () => {

    try {

      console.log("🧹 Running chat cleanup job...")

      const query = `
        DELETE FROM messages m
        USING orders o
        WHERE m.order_id = o.id
          AND (o.status = 'completed' OR o.status = 'ดำเนินการสำเร็จ' OR o.status = 'cancelled' OR o.status = 'ยกเลิกคำสั่งซ่อม')
          AND m.created_at < NOW() - INTERVAL '15 days'
      `

      const result = await pool.query(query)
      console.log(`✅ Deleted ${result.rowCount} old messages`)

    } catch (err) {
      console.error("❌ Cleanup crash:", err)
    }

  })

}