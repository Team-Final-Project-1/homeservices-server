import express from "express"
import { getSupabase } from "../utils/supabaseClient.mjs"
import { randomUUID } from "crypto"

const router = express.Router()

router.post("/upload", async (req, res) => {

  try {

    const { file } = req.body

    if (!file) {
      return res.status(400).json({ error: "No file" })
    }

    const supabase = getSupabase()

    const fileName = `chat/${randomUUID()}.png`

    // แปลง base64 → buffer
    const base64Data = file.split(",")[1]
    const buffer = Buffer.from(base64Data, "base64")

    const { error } = await supabase.storage
      .from("chat-images")
      .upload(fileName, buffer, {
        contentType: "image/png"
      })

    if (error) {
      return res.status(400).json(error)
    }

    const { data } = supabase.storage
      .from("chat-images")
      .getPublicUrl(fileName)

    res.json({ url: data.publicUrl })

  } catch (err) {
    console.error(err)
    res.status(500).json({ error: "Upload failed" })
  }

})

export default router