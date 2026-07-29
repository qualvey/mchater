# 💬 MyChat - 高颜值自建即时通讯与客服系统

[![Node.js](https://img.shields.io/badge/Node.js-v20%2B-green.svg)](https://nodejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-v4.8-blue.svg)](https://socket.io/)
[![SQLite](https://img.shields.io/badge/SQLite-better--sqlite3-blueviolet.svg)](https://www.sqlite.org/)
[![PM2 Supported](https://img.shields.io/badge/PM2-Supported-brightgreen.svg)](https://pm2.keymetrics.io/)
[![License](https://img.shields.io/badge/License-MIT-brightgreen.svg)](LICENSE)

**MyChat** 是一款基于 **Node.js + Socket.IO + SQLite** 架构的高颜值暗黑玻璃拟物风格（Dark Glassmorphism UI）即时通讯与客服系统。

专为**意向客户沟通与在线客服系统**打造：**免翻墙直连、无微信监管拦截风险、100% 数据自主可控**。支持独立部署与通用 SDK (`mychat-widget.js`) 一键嵌入任意网站。

---

## ✨ 核心功能亮点

### 1. 🎨 极致的现代视觉体验 (Dark Glassmorphism UI)
- **暗黑玻璃拟物设计**：采用 Tailored HSL 配色、柔和渐变与毛玻璃模糊效果（Backdrop Blur）。
- **微交互与响应式**：沉浸式动画、未读红点提示与移动端手势适配。

### 2. 💬 实时长连接与双向状态指示
- **低延迟长连接**：基于 Socket.IO 的 10 秒心跳包与断线自动重连。
- **双向“正在输入...”指示**：用户打字或管理员打字时，对方侧边/底部实时弹出微动画状态。

### 3. 📷 全窗口拖拽与剪贴板粘贴发图
- **全屏拖放**：将图片/文件拖入聊天窗口任意位置即可直接触发发送。
- **剪贴板粘贴**：支持按 `Ctrl + V` 直接粘贴截图发送。
- **大图预览 Modal**：点击聊天图片唤起全屏 Lightbox 预览。

### 4. 📁 文件传输审批流 (File Transfer Approval)
- **轻量元数据模式**：发送文件仅传输 ~200 字节的信令元数据，不占 WebSocket 通道。
- **管理员审批**：管理员侧呈现【同意接收】与【拒绝】按钮，经同意后触发高效 HTTP POST 流式上传。

### 5. 💾 SQLite + IndexedDB 双端离线消息队列
- **服务端 SQLite 持久化**：全量历史记录与文件状态安全落盘 SQLite（WAL 模式）。
- **IndexedDB 离线持久化**：用户发起的未传输大文件原生暂存至浏览器 `IndexedDB`，即使关闭/刷新页面，管理员后续离线批准后，用户上线**全自动补发上传**！

### 6. 👥 多客服团队与会话精准隔离
- **客户会话与团队内部双频道**：独立划分“💬 客户会话”与“👥 团队内部大厅/私聊”频道，严格防止客服内部沟通泄露到客户流。
- **双向同步删除与右键菜单**：右键点击侧边栏用户卡片，弹出拟物右键菜单（【🧹 清空聊天记录】与【🗑️ 彻底删除该会话】）。

### 7. 🛡️ 生产级安全加固与日志记录
- **可配置日志模块 (`logger.js`)**：支持 `debug`, `info`, `warn`, `error` 级别，精确记录登录失败、IP 轨迹与风险拦截。
- **文件后缀安全白名单**：严厉阻断 `.exe`, `.bat`, `.sh`, `.php`, `.js` 等可执行文件与木马。
- **滑动窗口速率限制 (Rate Limiter)**：限制同 IP 文件上传与同设备 Socket 消息频率。

---

## 🛠️ 技术栈

| 模块 | 技术选型 |
| :--- | :--- |
| **后端核心** | Node.js (v20+ LTS / v22+ LTS), Express (v5), HTTP |
| **实时通信** | Socket.IO (v4.8) |
| **数据库** | SQLite 3 (通过 `better-sqlite3` 驱动, WAL 高并发模式) |
| **进程守护** | PM2 (Process Manager 2) |
| **前端样式** | Vanilla CSS3 (Glassmorphism, CSS Custom Properties) |
| **客户端持久化** | LocalStorage + 原生 IndexedDB (`IDBFileStore`) |
| **安全鉴权** | Web Crypto API, JWT Token (HMAC-SHA256), Security Headers |

---

## 🚀 快速开始

### 1. 克隆与安装依赖

```bash
# 1. 克隆项目
git clone https://github.com/qualvey/mchater.git
cd mchater

# 2. 安装依赖
pnpm install  # 或 npm install
```

### 2. 本地开发启动

```bash
# 启动服务
node server.js
```

终端控制台将打印：
```text
=================================
💬 Chat Server running on http://127.0.0.1:4000
👤 Admin Username: tyu
🔑 Admin key: passwd
🔐 Admin Trigger Secret: sing
💾 SQLite Database connected: chat.db
=================================
```

---

## 🍀 PM2 生产环境部署与运维指南 (PM2 Deployment)

在 Linux 生产服务器上部署时，推荐使用 **PM2** 进行后台进程守护、崩溃自动重启与开机自启。

### 1. 安装 PM2

```bash
# 使用 npm 或 pnpm 全局安装 PM2
npm install -g pm2
# 或 pnpm add -g pm2
```

### 2. 启动服务 (PM2)

进入项目根目录 `/home/user/mchater` 执行：

```bash
# 启动服务并指定进程名称为 mchat-server
pm2 start server.js --name "mchat-server"
```

### 3. 常用 PM2 管理命令

| 操作 | 执行命令 | 说明 |
| :--- | :--- | :--- |
| **查看运行状态** | `pm2 status` | 查看 CPU/内存占用、在线状态与重启次数 |
| **重启服务** | `pm2 restart mchat-server` | 修改代码或 `config.json` 后热重载 |
| **查看实时日志** | `pm2 logs mchat-server` | 查看运行日志（包含登录失败、请求等） |
| **查看最后N行日志** | `pm2 logs mchat-server --lines 50` | 快速排查错误 |
| **停止服务** | `pm2 stop mchat-server` | 暂停后台守护进程 |
| **删除进程** | `pm2 delete mchat-server` | 从 PM2 列表中清除进程缓存 |
| **保存进程配置** | `pm2 save` | **重要**：保存当前 PM2 状态，防止服务器重启后丢失 |
| **设置开机自启** | `pm2 startup` | 生成并激活 Linux 开机自启动脚本 |

### 4. 生产环境更新代码步骤 (Deployment Workflow)

在 Linux 服务器更新代码时，请按照以下标准顺序：

```bash
cd /home/user/mchater

# 1. 拉取 Git 最新代码
git pull

# 2. 更新依赖包 (如新增或调整了 node 依赖)
pnpm install

# 3. 在 PM2 中重启服务
pm2 restart mchat-server

# 4. 检查服务状态
pm2 status
```

---

## 🌐 Nginx 反向代理配置示例

在 Nginx 中配置文件上传与 WebSocket 双向升级：

```nginx
server {
    listen 443 ssl http2;
    server_name sky.ryugo.org;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    # 设置允许最大上传文件 (配合 50MB 大文件上传)
    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        
        # WebSocket 支持
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "Upgrade";
        
        # 传递真实客户端 IP
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## ⚙️ 配置文件说明 (`config.json`)

根目录下的 `config.json` 用于管理端口、默认凭证与日志级别：

```json
{
  "hostname": "127.0.0.1",
  "port": 4000,
  "adminUsername": "admin",
  "adminKey": "admin123",
  "adminTriggerCode": "sing",
  "log": {
    "level": "debug"
  }
}
```

- `hostname`: 监听绑定的网卡 IP (`127.0.0.1` 本地回环，或 `0.0.0.0` 允许公网直接访问)。
- `port`: 服务运行端口（默认 `4000`）。
- `adminUsername`: 默认超级主管理员账号。
- `adminKey`: 默认超级主管理员密码。
- `adminTriggerCode`: 登录入口触发暗号。
- `log.level`: 日志级别 (`debug`, `info`, `warn`, `error`, `none`)。

---

## 📁 目录结构说明

```text
mychat/
├── config.json              # 项目配置文件 (端口/密钥/日志级别)
├── logger.js                # 分级日志记录模块
├── db.js                    # SQLite 数据库核心封装 (Better-SQLite3)
├── server.js                # Node.js + Express + Socket.IO 后端主服务
├── routes/                  # 模块化 REST API 路由
│   ├── public.routes.js     # 文件上传与公共接口
│   └── admin.routes.js      # 管理员登录与子账号管理接口
├── sockets/                 # 模块化 Socket.IO 事件处理器
│   ├── user.socket.js       # 客户端消息与在线状态逻辑
│   └── admin.socket.js      # 管理员侧回复与团队内部通信逻辑
├── public/                  # 前端静态资源目录
│   ├── index.html           # 主页面 HTML
│   ├── js/
│   │   ├── app.js           # 前端 ES Module 主逻辑入口
│   │   ├── mychat-widget.js # 嵌入式客服 SDK 脚本
│   │   ├── storage.js       # LocalStorage 管理工具
│   │   ├── idb-store.js     # IndexedDB 大文件持久化模块
│   │   └── modules/         # 前端组件化模块 (user-chat, admin-customer, admin-team)
│   └── uploads/             # 上传文件存储目录
└── package.json
```

---

## 📄 开源许可证

本项目采用 [MIT License](LICENSE) 许可证开源。
