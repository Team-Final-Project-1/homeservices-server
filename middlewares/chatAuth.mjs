import { getSupabase } from "../utils/supabaseClient.mjs"

// ======================================
// CHAT AUTH MIDDLEWARE
// ======================================

export const requireChatAccess = async (req, res, next) => {

  try {

    const orderId =
      req.params.orderId ||
      req.body.order_id ||
      req.query.orderId

    const userId =
      req.body.sender_id ||
      req.body.userId ||
      req.query.userId

    if (!orderId || !userId) {
      return res.status(400).json({
        error: "orderId and userId required"
      })
    }

    const supabase = getSupabase()

    // ==============================
    // GET ORDER
    // ==============================

    const { data: order, error: orderError } = await supabase
      .from("orders")
      .select("id, user_id, status, service_status")
      .eq("id", orderId)
      .single()

    if (orderError || !order) {
      return res.status(404).json({
        error: "Order not found"
      })
    }

    // ==============================
    // BUSINESS RULES
    // ==============================

    if (order.status !== "paid") {
      return res.status(403).json({
        error: "Chat not available until payment"
      })
    }

    if (order.service_status === "completed") {
      return res.status(403).json({
        error: "Chat is closed"
      })
    }

    // ==============================
    // CHECK USER ROLE
    // ==============================

    const { data: tech } = await supabase
      .from("technician_assignments")
      .select("technician_id")
      .eq("order_id", orderId)
      .maybeSingle()

    const isCustomer = userId === order.user_id
    const isTechnician = userId === tech?.technician_id

    if (!isCustomer && !isTechnician) {
      return res.status(403).json({
        error: "Unauthorized"
      })
    }

    // ✅ attach to request (ใช้ต่อใน route ได้)
    req.chat = {
      order,
      userId
    }

    next()

  } catch (err) {

    console.error("❌ Chat middleware error:", err)

    res.status(500).json({
      error: "Chat auth failed"
    })

  }

}