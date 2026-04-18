import pool from "../utils/db.mjs"

// ======================================
// HELPER: map INT -> UUID
// ======================================
async function mapUserIdToUUID(user_id) {
  const query = `
    SELECT auth_user_id
    FROM users
    WHERE id = $1
  `
  const { rows } = await pool.query(query, [Number(user_id)])

  if (!rows.length) {
    throw new Error("User not found")
  }

  return rows[0].auth_user_id
}

// ======================================
// CHECK CHAT ACCESS
// ======================================
export async function validateChatAccess(order_id, user_id) {

  //  เปลี่ยนมาใช้ assignment
  const { rows } = await pool.query(`
    SELECT 
      o.id,
      o.user_id,
      o.status,
      ta.technician_id
    FROM orders o

    LEFT JOIN LATERAL (
      SELECT technician_id
      FROM technician_assignments ta
      WHERE ta.order_id = o.id
      ORDER BY ta.id DESC
      LIMIT 1
    ) ta ON true

    WHERE o.id = $1
  `, [Number(order_id)])

  const order = rows[0]

  if (!order) throw new Error("Order not found")

  // เช็คจาก assignment แทน
  if (!order.technician_id) {
    throw new Error("Chat not available yet")
  }

  // ห้ามแชทถ้างานเสร็จแล้วหรือถูกยกเลิก
  const closedStatuses = ['completed', 'ดำเนินการสำเร็จ', 'cancelled', 'ยกเลิกคำสั่งซ่อม'];
  if (closedStatuses.includes(order.status)) {
    throw new Error("Chat is closed for this order status");
  }

  const isCustomer =
    String(user_id) === String(order.user_id)

  const isTechnician =
    String(user_id) === String(order.technician_id)

  if (!isCustomer && !isTechnician) {
    throw new Error("Unauthorized")
  }

  return {
    order,
    role: isCustomer ? "customer" : "technician"
  }
}

// ======================================
// SEND MESSAGE
// ======================================
export async function sendMessage({ order_id, sender_id, message, image }) {

  const { role } = await validateChatAccess(order_id, sender_id)

  const senderUUID = await mapUserIdToUUID(sender_id)

  const { rows } = await pool.query(`
    INSERT INTO messages (order_id, sender_id, sender_role, message, image, is_read)
    VALUES ($1, $2, $3, $4, $5, false)
    RETURNING *
  `, [
    Number(order_id),
    senderUUID,
    role,
    message || null,
    image || null
  ])

  return rows[0]
}

// ======================================
// GET MESSAGES
// ======================================
export async function getMessages(orderId, userId, page = 1) {

  await validateChatAccess(orderId, userId)

  const limit = 30
  const offset = (page - 1) * limit

  const { rows } = await pool.query(`
    SELECT 
      m.*,
      u.id AS sender_id_int
    FROM messages m
    JOIN users u 
      ON u.auth_user_id = m.sender_id
    WHERE m.order_id = $1
    ORDER BY m.created_at ASC
    LIMIT $2 OFFSET $3
  `, [
    Number(orderId),
    limit,
    offset
  ])

  const mapped = rows.map(m => ({
    ...m,
    sender_id: String(m.sender_id_int)
  }))

  return mapped
}

// ======================================
// MARK READ
// ======================================
export async function markAsRead(orderId, userId) {

  await validateChatAccess(orderId, userId)

  const senderUUID = await mapUserIdToUUID(userId)

  await pool.query(`
    UPDATE messages
    SET is_read = true
    WHERE order_id = $1
      AND sender_id != $2
      AND is_read = false
  `, [
    Number(orderId),
    senderUUID
  ])

  return true
}

// ======================================
// UNREAD COUNT
// ======================================
export async function getUnreadCount(orderId, userId) {

  await validateChatAccess(orderId, userId)

  const senderUUID = await mapUserIdToUUID(userId)

  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS count
    FROM messages
    WHERE order_id = $1
      AND is_read = false
      AND sender_id != $2
  `, [
    Number(orderId),
    senderUUID
  ])

  return rows[0]?.count || 0
}