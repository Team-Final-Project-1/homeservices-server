import cron from "node-cron"
import { getSupabase } from "./supabaseClient.mjs"

export const startChatCleanup = () => {

  // run every day at 03:00 AM
  cron.schedule("0 3 * * *", async () => {

    try {

      console.log("🧹 Running chat cleanup job...")

      const supabase = getSupabase()

      const sevenDaysAgo = new Date()

      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

      const { error } = await supabase
        .from("messages")
        .delete()
        .lt("created_at", sevenDaysAgo.toISOString())

      if (error) {

        console.error("❌ Chat cleanup error:", error)

      } else {

        console.log("✅ Old chat deleted")

      }

    } catch (err) {

      console.error("❌ Cleanup crash:", err)

    }

  })

}