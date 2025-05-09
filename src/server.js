require("dotenv").config();
const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const checkAuth = require("./middlewares/checkAuth");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { getAIReply } = require("./services/aiService");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
app.use(express.json());
app.use(cookieParser());
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

//加在 io.on 之前：Socket.IO 的中介層驗證
io.use((socket, next) => {
  let token;

  // 1. 優先從 cookie 抓（正式環境）
  const cookieHeader = socket.request.headers.cookie;
  if (cookieHeader) {
    token = cookieHeader
      .split("; ")
      .find((cookie) => cookie.startsWith("access_token="))
      ?.split("=")[1];
  }

  // 2. Postman 可傳 query token，例如：?token=xxx
  if (!token && socket.handshake.query?.token) {
    token = socket.handshake.query.token;
  }

  //3. 支援 Postman Socket.IO GUI 傳入的 auth.token
  if (!token && socket.handshake.auth?.token) {
    token = socket.handshake.auth.token;
  }

  if (!token) {
    return next(new Error("請先登入會員"));
  }
  //   const cookieHeader = socket.request.headers.cookie;

  //   if (!cookieHeader) {
  //     return next(new Error("請先登入會員"));
  //   }

  //   const token = cookieHeader
  //     .split("; ")
  //     .find((cookie) => cookie.startsWith("access_token="))
  //     ?.split("=")[1];

  //   if (!token) {
  //     return next(new Error("token不存在"));
  //   }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded; // 將解碼的使用者資訊存入 socket 物件
    next();
  } catch (error) {
    return next(new Error("token驗證失敗"));
  }
});

//🔐 雙向交握（Handshake）
// 測試連線
io.on("connection", (socket) => {
  console.log(`${socket.id} 使用者已經連線！！！使用者資訊：`, socket.user);
  console.log("socket.request.headers", socket.request.headers);

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

app.get("/check", checkAuth, (req, res) => {
  res.json({
    message: "微服務已登入",
    user: req.user,
  });
});

server.listen(process.env.PORT || 5005, () => {
  console.log(`伺服器啟動於 port ${process.env.PORT || 5005}`);
});
