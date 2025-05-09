const { OpenAI } = require("openai");
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // 來自 .env 的金鑰
});

async function getAIReply(message) {
  const response = await openai.chat.completions.create({
    model: "gpt-3.5-turbo",
    messages: [
      {
        role: "system",
        content:
          "你是一個親切的露營票務活動系統網站的客服機器人，請用繁體中文簡明扼要地回答使用者的問題。",
      },
      {
        role: "user",
        content: message,
      },
    ],
  });

  console.log("完整版的res", response);
  console.log("AI 回覆：", response.choices[0].message.content);

  return response.choices[0].message.content;
}

module.exports = {
  getAIReply,
};
// 這個檔案是用來處理與 OpenAI API 的互動
// 主要功能是發送訊息並獲取 AI 的回覆
// 這裡使用了 openai 套件來簡化 API 的請求
// 這個檔案會被 server.js 引入，並在 socket.io 的事件中使用
// 這樣可以讓我們在伺服器端處理 AI 的回覆邏輯
