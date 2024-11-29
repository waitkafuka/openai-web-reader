# Web Chat Application

一个基于 Node.js 和 Express 的网页聊天应用，支持网页内容爬取和 AI 对话功能。

## 功能特点

- 实时聊天界面
- 网页内容爬取
- AI 智能对话（基于 GPT-4）
- 流式响应
- 消息重新生成
- 错误处理和日志记录

## 技术栈

- 后端：Node.js + Express
- 前端：原生 HTML/CSS/JavaScript
- 爬虫：Cheerio + Axios
- 日志：Winston + Morgan
- AI：OpenAI GPT-4 API

## 安装步骤

1. 克隆项目

```bash
git clone [项目地址]
cd [项目目录]
```

2. 安装依赖

```bash
npm install
```

3. 配置环境变量
   创建 `.env` 文件并添加以下配置：

```bash
OPENAI_API_URL=https://api.xxxx.com
OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

4. 启动服务器

```bash
pm2 start ecosystem.config.js
```

5. 访问应用
   打开浏览器访问 `http://localhost:2918`

## 使用说明

1. 在输入框中输入消息或网页 URL
2. 点击"发送"按钮或按回车键发送消息
3. 如需重新生成回复，点击"重新生成"按钮
4. 系统会自动爬取 URL 内容并通过 AI 进行处理

## API 接口

### POST /api/chat

处理用户消息和 AI 对话

### POST /web-crawling

爬取指定 URL 的网页内容

## 注意事项

- 确保已安装 Node.js (推荐版本 14+)
- 需要有效的 OpenAI API 密钥
- 网页爬取功能可能受目标网站的访问限制

## 许可证

MIT

## 贡献指南

欢迎提交 Issue 和 Pull Request
