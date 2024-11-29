const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const path = require("path");
const morgan = require("morgan");
const winston = require("winston");
const app = express();
const { processUserQuery } = require("./utils");
const cors = require("cors");

// 配置 Winston 日志记录器
const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

// 在开发环境下同时输出到控制台
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  );
}

// 中间件设置
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../web")));
// 添加 Morgan 请求日志
app.use(
  morgan("combined", {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  })
);
app.use(cors());

// 基础路由示例
app.get("/", (req, res) => {
  //返回web目录
  res.sendFile(path.join(__dirname, "../web/index.html"));
});

app.post("/api/chat", (req, res) => {
  try {
    const userInput = req.body.message;

    const stream = processUserQuery(userInput);

    // 修改 Content-Type 为 text/event-stream
    // res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    // 监听流事件，实时发送数据给客户端
    stream.on("data", (chunk) => {
      console.log("chunk", chunk.toString());
      res.write(chunk);
    });

    stream.on("end", () => {
      res.end();
    });

    stream.on("error", (error) => {
      console.error("流错误:", error);
      res.status(500).send("发生错误。");
    });
  } catch (error) {
    logger.error("处理 /chat 请求失败:", error);
    res.status(500).json({ error: "服务器内部错误" });
  }
});

// 网页爬虫接口
app.post("/web-crawling", async (req, res) => {
  try {
    const { url } = req.body;

    if (!url) {
      logger.warn("爬虫请求失败：未提供URL");
      return res.status(400).json({
        error: "请提供URL参数",
      });
    }

    logger.info(`开始爬取URL: ${url}`);

    // 获取网页内容，模拟真实user agent
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.3'
      }
    });
    logger.info(`成功获取网页内容，状态码: ${response.status}`);
    const html = response.data;

    // 使用cheerio加载HTML
    const $ = cheerio.load(html);
    logger.debug("HTML解析完成");

    // 移除所有不需要的标签，增加更多选择器
    $(
      "script, style, noscript, iframe, img, link, meta, svg, path, button"
    ).remove();
    $('[type="text/css"]').remove(); // 移除所有带有 type="text/css" 属性的元素
    $("[data-for]").remove(); // 移除所有带有 data-for 属性的元素
    $("*[style]").removeAttr("style"); // 移除所有style属性

    // 提取文本内容，并进行清理
    let text = $("body")
      .clone()
      .find("*")
      .contents()
      .map(function () {
        // 只保留文本节点，且内容不为空，且不包含样式相关内容
        if (this.type === "text") {
          const content = this.data.trim();
          // 过滤掉可能的样式相关文本
          if (
            content &&
            !content.includes("style") &&
            !content.includes("css") &&
            !content.includes("{") &&
            !content.includes("}")
          ) {
            return content;
          }
        }
      })
      .get()
      .join(" ")
      .replace(/\s+/g, " ")
      .replace(/[\r\n]+/g, "\n")
      .trim();

    logger.info(`网页爬取成功，提取文本长度: ${text.length}`);
    res.json({
      success: true,
      text: text,
    });
  } catch (error) {
    logger.error("爬虫请求失败", {
      error: error.message,
      stack: error.stack,
    });
    res.status(500).json({
      error: "爬取网页失败",
      message: error.message,
    });
  }
});

// 启动服务器
const PORT = 2918;
app.listen(PORT, () => {
  logger.info(`服务器已启动，正在监听端口 ${PORT}`);
});

// 添加未捕获异常的处理
process.on("uncaughtException", (error) => {
  logger.error("未捕获的异常", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("未处理的Promise拒绝", {
    reason: reason,
    promise: promise,
  });
});
