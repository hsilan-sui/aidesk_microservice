require("dotenv").config();
const express = require("express");
const http = require("http");
const cors = require("cors");
const { getAIReply } = require("./services/aiService");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

//🔐 雙向交握（Handshake）
// 測試連線
io.on("connection", (socket) => {
  console.log(`${socket.id} 使用者已經連線！！！`);

  socket.on("client:message", async (msg) => {
    console.log(`收到來自 ${socket.id} 的訊息：${msg}`);

    try {
      const aiText = await getAIReply(msg);
      socket.emit("ai:reply", aiText);
    } catch (error) {
      console.error("AI 回覆錯誤：", error);
      socket.emit("ai:reply", "抱歉，我無法處理您的請求。");
    }
    //假裝ai回覆
    // socket.emit(
    //   "ai:reply",
    //   `森森不息AI回覆：嗨！你說的是${msg}嗎？ 系統維護中，請稍後再試！`
    // );
  });

  // 處理離線事件
  socket.on("disconnect", (reason) => {
    console.log(`使用者 ${socket.id} 已離線：${reason}`);
  });
});

app.get("/", (req, res) => {
  res.send("AI 客服伺服器正在運行中...");
});

server.listen(process.env.PORT || 5005, () => {
  console.log(`伺服器啟動於 port ${process.env.PORT || 5005}`);
});
