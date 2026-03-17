export const initSocket = (io) => {

    const onlineUsers = new Map()
  
    io.on("connection", (socket) => {
  
      console.log("🔌 Socket connected:", socket.id)
  
      socket.on("user_online", ({ userId }) => {
        if (!userId) return
  
        onlineUsers.set(userId, socket.id)
  
        io.emit("online_users", Array.from(onlineUsers.keys()))
      })
  
      socket.on("join_room", (orderId) => {
        if (!orderId) return
        socket.join(orderId)
      })
  
      socket.on("send_message", (message) => {
        if (!message?.order_id) return
        io.to(message.order_id).emit("receive_message", message)
      })
  
      socket.on("close_room", (orderId) => {
        io.to(orderId).emit("chat_closed")
      })
  
      socket.on("disconnect", () => {
        for (const [userId, socketId] of onlineUsers.entries()) {
          if (socketId === socket.id) {
            onlineUsers.delete(userId)
            break
          }
        }
  
        io.emit("online_users", Array.from(onlineUsers.keys()))
      })
  
    })
  }