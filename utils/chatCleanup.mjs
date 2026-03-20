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
          AND o.service_status = 'completed'
          AND m.created_at < NOW() - INTERVAL '30 days'
      `

      const result = await pool.query(query)

      console.log(`✅ Deleted ${result.rowCount} old messages`)

    } catch (err) {
      console.error("❌ Cleanup crash:", err)
    }

  })

}