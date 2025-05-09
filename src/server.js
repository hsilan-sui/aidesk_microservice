require("dotenv").config();
const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const checkAuth = require("./middlewares/checkAuth");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { getAIReply } = require("./services/aiService");
const { Server } = require("socket.io");
const redis = require("./utils/redis");

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
  const userId = socket.user?.id;
  if (!userId) {
    socket.disconnect();
    return;
  }

  console.log(`${socket.id} 使用者已經連線！！！使用者資訊：`, socket.user);
  console.log("socket.request.headers", socket.request.headers);

  socket.on("client:message", async (msg) => {
    //幫使用者 userId 建一個聊天抽屜（叫做 chatlog:userId），然後把這句話記下來，塞到最下面！
    try {
      //1.存使用者訊息(像聊天歷史的備份)
      await redis.rpush(
        `chatlog:${userId}`,
        JSON.stringify({
          role: "user",
          content: msg,
          timestamp: Date.now(),
        })
      );

      //這代表只保留後面 20 筆資料（FIFO） ==> 測試
      await redis.ltrim(`chatlog:${userId}`, -20, -1);
      await redis.expire(`chatlog:${userId}`, 60 * 60 * 24); // 設定過期時間為 24 小時

      //1.5 => 取得最近上下文（最多 10 則）
      const logs = await redis.lrange(`chatlog:${userId}`, -10, -1);
      console.log(`${userId}logs在這裏`, logs);
      const messages = logs.map((item) => {
        const parsedMsg = JSON.parse(item);
        return {
          role: parsedMsg.role,
          content: parsedMsg.content,
        };
      });

      //2.呼叫AI回覆
      const reply = await getAIReply(messages); // 根據1.5的新增=>修改 aiService 規格，支援 messages//==>呼叫 GPT，帶入上下文

      //3.儲存ai回覆
      await redis.rpush(
        `chatlog:${userId}`,
        JSON.stringify({
          role: "assistant", // 這裡的 role 是 "ai" => assistant
          content: reply,
          timestamp: Date.now(),
        })
      );
      //這代表只保留後面 10 筆資料（FIFO） ==> 測試
      await redis.ltrim(`chatlog:${userId}`, -20, -1);
      await redis.expire(`chatlog:${userId}`, 60 * 60 * 24); // 設定過期時間為 24 小時

      //4.把ai的回覆發送給使用者
      socket.emit("ai:reply", reply);
    } catch (error) {
      console.error("Redis 或 AI 回覆失敗", error);
      socket.emit("aiReply", "系統忙線中，請稍候再試。");
    }
    // console.log(`收到來自 ${socket.id} 的訊息：${msg}`);

    // try {
    //   const aiText = await getAIReply(msg);
    //   socket.emit("ai:reply", aiText);
    // } catch (error) {
    //   console.error("AI 回覆錯誤：", error);
    //   socket.emit("ai:reply", "抱歉，我無法處理您的請求。");
    // }
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

app.get("/chatlog", checkAuth, async (req, res) => {
  const userId = req.user?.id;
  try {
    const rawChatlog = await redis.lrange(`chatlog:${userId}`, 0, -1);
    const chatlog = rawChatlog.map((item) => JSON.parse(item));

    res.json({
      user: userId,
      chatlog,
    });
  } catch (error) {
    res.status(500).json({ message: "讀取聊天紀錄失敗", error: err.message });
  }
});

app.delete("/chatlog", checkAuth, async (req, res) => {
  const userId = req.user.id;
  const key = `chatlog:${userId}`;

  try {
    const deletedCount = await redis.del(key);

    if (deletedCount === 1) {
      res.json({ message: "聊天紀錄已清空" });
    } else {
      res.status(404).json({ message: "找不到聊天紀錄" });
    }
  } catch (err) {
    console.error("清除聊天紀錄失敗", err);
    res.status(500).json({ message: "清除失敗", error: err.message });
  }
});

server.listen(process.env.PORT || 5005, () => {
  console.log(`伺服器啟動於 port ${process.env.PORT || 5005}`);
});
