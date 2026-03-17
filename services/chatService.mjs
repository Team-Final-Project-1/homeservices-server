import { getSupabase } from "../utils/supabaseClient.mjs"

// ======================================
// CHECK CHAT ACCESS
// ======================================

export async function validateChatAccess(order_id, user_id) {

  const supabase = getSupabase()

  // order
  const { data: order, error } = await supabase
    .from("orders")
    .select("id, user_id, status, service_status")
    .eq("id", order_id)
    .single()

  if (error || !order) {
    throw new Error("Order not found")
  }

  if (order.status !== "paid") {
    throw new Error("Chat not available until payment")
  }

  if (order.service_status === "completed") {
    throw new Error("Chat is closed")
  }

  // technician
  const { data: tech } = await supabase
    .from("technician_assignments")
    .select("technician_id")
    .eq("order_id", order_id)
    .maybeSingle()

  const isCustomer = user_id === order.user_id
  const isTechnician = user_id === tech?.technician_id

  if (!isCustomer && !isTechnician) {
    throw new Error("Unauthorized")
  }

  return true
}


// ======================================
// SEND MESSAGE
// ======================================

export async function sendMessage({ order_id, sender_id, message }) {

  const supabase = getSupabase()

  await validateChatAccess(order_id, sender_id)

  const { data, error } = await supabase
    .from("messages")
    .insert([
      {
        order_id,
        sender_id,
        message,
        is_read: false
      }
    ])
    .select()

  if (error) throw error

  return data[0]
}


// ======================================
// GET MESSAGES
// ======================================

export async function getMessages(orderId, userId, page = 1) {

  const supabase = getSupabase()

  await validateChatAccess(orderId, userId)

  const limit = 30
  const from = (page - 1) * limit
  const to = from + limit - 1

  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true })
    .range(from, to)

  if (error) throw error

  return data
}


// ======================================
// MARK READ
// ======================================

export async function markAsRead(orderId, userId) {

  const supabase = getSupabase()

  await validateChatAccess(orderId, userId)

  const { error } = await supabase
    .from("messages")
    .update({ is_read: true })
    .eq("order_id", orderId)
    .neq("sender_id", userId)

  if (error) throw error

  return true
}


// ======================================
// UNREAD COUNT
// ======================================

export async function getUnreadCount(orderId, userId) {

  const supabase = getSupabase()

  await validateChatAccess(orderId, userId)

  const { data, error } = await supabase
    .from("messages")
    .select("id")
    .eq("order_id", orderId)
    .eq("is_read", false)
    .neq("sender_id", userId)

  if (error) throw error

  return data.length
}