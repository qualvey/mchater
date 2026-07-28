# 💬 MyChat - 高颜值自建即时通讯与客服系统

[![Node.js](https://img.shields.io/badge/Node.js-v18%2B-green.svg)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-v4.8-blue.svg)](https://socket.io/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-blueviolet.svg)](https://www.sqlite.org/)
[![License](https://img.shields.io/badge/License-MIT-brightgreen.svg)](LICENSE)

**MyChat** 是一款基于 **Node.js + Socket.IO + SQLite** 架构的高颜值暗黑玻璃拟物风格（Dark Glassmorphism UI）即时通讯系统。

专为**意向客户沟通与在线客服系统**打造：**免翻墙直连、无微信监管拦截风险、100% 数据自主可控**。支持独立部署，未来可作为通用组件快捷嵌入任意网站。

---

## ✨ 核心功能亮点

### 1. 🎨 极致的现代视觉体验 (Dark Glassmorphism UI)
- **暗黑玻璃拟物设计**：采用 Tailored HSL 配色、柔和渐变与毛玻璃模糊效果（Backdrop Blur）。
- **微交互与响应式**：沉浸式动画、未读未读红点提示与流畅的设备窗口适配。

### 2. 💬 实时长连接与双向状态指示
- **低延迟长连接**：基于 Socket.IO 的 10 秒心跳包与断线自动重连。
- **双向“正在输入...”指示**：用户打字或管理员打字时，对方侧边/底部实时弹出微动画状态。

### 3. 📷 全窗口拖拽与剪贴板粘贴发图
- **全屏拖放**：将图片文件拖入聊天窗口任意位置即可直接触发发送。
- **剪贴板粘贴**：支持按 `Ctrl + V` 直接粘贴截图发送。
- **大图预览 Modal**：点击聊天图片唤起全屏 Lightbox 预览。

### 4. 📁 文件传输审批流 (File Transfer Approval)
- **轻量元数据模式**：发送文件仅传输 ~200 字节的信令元数据，不占 WebSocket 通道。
- **管理员审批**：管理员侧呈现【同意接收】与【拒绝】按钮，经同意后触发高效 HTTP POST 流式上传。

### 5. 💾 SQLite + IndexedDB 双端离线消息队列
- **服务端 SQLite 持久化**：全量历史记录与文件状态安全落盘 SQLite（WAL 模式）。
- **IndexedDB 离线持久化**：用户发起的未传输大文件原生暂存至浏览器 `IndexedDB`，哪怕关闭/刷新页面，管理员后续离线批准后，用户上线**全自动补发上传**！

### 6. 🗑️ 双向同步删除与右键菜单
- **侧边栏拟物右键菜单**：右键点击侧边栏用户卡片，弹出右键菜单（支持【🧹 清空聊天记录】与【🗑️ 彻底删除该会话】），自带智能屏幕碰撞防溢出定位。
- **全网双向实时擦除 (Delete for Both Sides)**：管理员删除时，在线用户侧同步擦除 LocalStorage 与 UI 卡片；离线用户上线自动同步抹除。

### 7. 🛡️ 生产级安全加固 (Security Hardening)
- **文件后缀安全白名单**：严厉阻断 `.exe`, `.bat`, `.sh`, `.php`, `.js` 等可执行文件与木马。
- **滑动窗口速率限制 (Rate Limiter)**：限制同 IP 文件上传与同设备 Socket 消息频率，防范 CC/DOS 轰炸。
- **跨站安全 (XSS & Security Headers)**：全量 HTML 字符转义、注入 `X-Content-Type-Options: nosniff` 与 `X-Frame-Options: SAMEORIGIN` 防护。
- **JWT Token 动态鉴权**：登录成功签发 HMAC-SHA256 JWT Token，替代明文密码网络暴露风险。

---

## 🛠️ 技术栈

| 模块 | 技术选型 |
| :--- | :--- |
| **后端核心** | Node.js (v18+), Express (v4), HTTP |
| **实时通信** | Socket.IO (v4.8) |
| **数据库** | SQLite 3 (通过 `better-sqlite3` 驱动, WAL 高并发模式) |
| **前端样式** | Vanilla CSS3 (Glassmorphism, CSS Custom Properties) |
| **客户端持久化** | LocalStorage + 原生 IndexedDB (`IDBFileStore`) |
| **安全鉴权** | Web Crypto API, JWT Token (HMAC-SHA256), Security Headers |

---

## 🚀 快速开始

### 1. 克隆与安装依赖

```bash
# 1. 克隆项目
git clone https://github.com/your-username/mychat.git
cd mychat

# 2. 安装依赖
npm install
```

### 2. 启动服务

```bash
# 启动服务
node server.js
```

终端控制台将打印：
```text
=================================
💬 Chat Server running on http://localhost:3000
🔑 Admin key: admin123
🔐 Admin Trigger Secret: admin888
💾 SQLite Database connected: chat.db
=================================
```

### 3. 打开浏览器访问

- **普通用户侧**：打开 `http://localhost:3000`，输入昵称与请求原因，直接进入聊天。
- **管理员侧**：在同一个页面或新浏览器窗口打开 `http://localhost:3000`，切换至管理员登录，输入密钥 `admin123`（或输入触发暗号 `admin888` 展开管理员入口）。

---

## ⚙️ 配置文件说明 (`config.json`)

根目录下的 `config.json` 用于管理端口与认证密钥：

```json
{
  "port": 3000,
  "adminKey": "admin123",
  "adminTriggerCode": "admin888"
}
```

- `port`: 服务运行端口（默认 `3000`）。
- `adminKey`: 管理员登录密钥。
- `adminTriggerCode`: 用户端隐秘触发暗号。

---

## 📁 目录结构说明

```text
mychat/
├── config.json              # 项目配置文件 (端口/密钥)
├── db.js                    # SQLite 数据库核心封装 (Better-SQLite3)
├── server.js                # Node.js + Express + Socket.IO 后端主服务
├── plan.md                  # 开发需求与迭代计划
├── bug.md                   # Bug 追踪记录
├── doc/                     # 项目技术架构与演进路线图
│   ├── offline_message_sync_technical_doc.md  # 离线消息与大文件同步复盘文档
│   └── future_development_roadmap.md          # 生产级通用客服组件演进路线图
├── public/                  # 前端静态资源目录
│   ├── index.html           # 主页面 HTML
│   ├── css/
│   │   └── style.css        # 玻璃拟物 CSS 全套样式
│   ├── js/
│   │   ├── app.js           # 前端应用核心逻辑
│   │   ├── storage.js       # LocalStorage 管理工具
│   │   └── idb-store.js     # IndexedDB 大文件持久化模块
│   └── uploads/             # 上传文件存储目录
└── package.json
```

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 许可证开源。
