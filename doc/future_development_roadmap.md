# MyChat 生产级通用客服组件与架构演进路线图 (Future Development Roadmap)

> **文档目的**：本文档规划了 MyChat 从高质量原型向**生产级（Production-Grade）通用客服系统与嵌入式 SDK 组件**演进的未来路线图与架构优化指南。

---

## 📌 演进蓝图与核心方向

```
                              MyChat 生产级演进蓝图
 ┌─────────────────────────────────────────────────────────────────────────────┐
 │ 1. 前端嵌入式 SDK     │ 一键注入脚本、Iframe 样式隔离、postMessage 跨域桥梁    │
 ├───────────────────────┼─────────────────────────────────────────────────────┤
 │ 2. 多客服与工作台     │ 多租户隔离、客服路由分发(轮询/空闲)、快捷回复、会话转接│
 ├───────────────────────┼─────────────────────────────────────────────────────┤
 │ 3. 高并发与分布式扩展 │ Redis Pub/Sub 扩展、PostgreSQL 迁移、S3/OSS 直传   │
 ├───────────────────────┼─────────────────────────────────────────────────────┤
 │ 4. AI 智能客服与画像  │ 接入 DeepSeek/OpenAI RAG 机器人、访客浏览轨迹跟踪    │
 ├───────────────────────┼─────────────────────────────────────────────────────┤
 │ 5. 运维监控与可靠性   │ 结构化 Pino/Winston 日志、SIGTERM 优雅停机、PM2 集群 │
 └─────────────────────────────────────────────────────────────────────────────┘
```

---

## 一、 前端：通用嵌入式 SDK 架构 (Embeddable Widget SDK)

为了将 MyChat 打造为可以一键接入任意第三方网站的通用客服组件：

### 1.1 一键注入脚本 (`mychat-widget.js`)
- 提供标准的单行嵌入 JavaScript 脚本：
  ```html
  <script src="https://your-domain.com/widget.js" data-tenant-id="tenant_123" async></script>
  ```
- 自动在宿主网站右下角渲染胶囊状悬浮图标（如 `💬 咨询客服 [未读红点]`）。

### 1.2 Iframe 沙箱与样式绝对隔离
- 点击图标后展开基于 Iframe 的聊天组件。
- **优势**：彻底隔离第三方宿主网站的 CSS 全局样式污染（如全局 `* { box-sizing: content-box }` 或 Tailwind 重置样式）和 JavaScript 命名空间冲突。

### 1.3 `postMessage` 跨域通讯桥梁 (PostMessage Bridge)
- 宿主网页与客服 Iframe 之间通过 `window.postMessage` 安全通信。
- 支持宿主网页主动传递登录用户信息（如 `user_id`, `vip_level`）及**客户当前正在浏览的商品页面 URL**，实现无缝上下文注入。

### 1.4 CSS 自定义主题变量 (Theme Customization)
- 支持宿主网站传入品牌主色调 (Primary Color)、客服 Logo、欢迎语等参数，动态覆盖 CSS 自定义属性。

---

## 二、 业务：多租户与多客服协同工作台 (Multi-Tenant & Agent Workspace)

### 2.1 多租户数据隔离 (Multi-Tenancy)
- 数据库与服务端增加 `tenant_id` 租户识别，支持单套 MyChat 服务于多个独立的商户与网站。

### 2.2 多客服账号与智能路由分发 (Agent Routing & Transfer)
- 支持管理员创建多个客服账号（客服 1、客服 2）。
- **路由分发算法**：根据客服在线状态、**最少空闲接单 (Least Busy)** 或轮询 (Round-Robin) 自动分配新访客。
- **会话转接 (Session Transfer)**：客服之间可互相转接疑难问题会话。

### 2.3 快捷回复/常用话术库 (Canned Responses)
- 客服输入 `/` 或按快捷键弹窗，快速搜索并发送预设话术（如欢迎语、价格表、常见故障排查步骤）。

### 2.4 Web Audio 提示音与桌面 Notification
- 增加新访客接入、新消息到达时的 Web Audio 音效提示与浏览器 Notification。

---

## 三、 后端：高并发、分布式扩展与云存储 (Scalability & Cloud)

### 3.1 Socket.IO 节点集群扩展 (Redis Adapter)
- 引入 `@socket.io/redis-adapter`，结合 PM2 或 Kubernetes (K8s) 部署多个 Node.js 实例。
- 利用 Redis Pub/Sub 实现跨服务器节点的实时消息广播与连接均衡。

### 3.2 数据库演进 (PostgreSQL / MySQL + ORM)
- 从单机 SQLite WAL 模式演进为 **PostgreSQL / MySQL**，配合 **Prisma ORM** 或 **Drizzle ORM** 数据访问层，支持高并发读写分离与主从集群。

### 3.3 云端对象存储直传 (S3 / 阿里云 OSS / 腾讯云 COS)
- 服务端仅签发 **预签名上传 URL (Presigned URL)**，客户端将图片和大文件直传云端对象存储 OSS，**极大释放 Node.js 服务器的 CPU 与带宽压力**。

---

## 四、 智能化：AI 客服与访客轨迹画像 (AI LLM & Visitor Analytics)

### 4.1 接入大模型 AI 智能客服 (LLM / RAG Support)
- 接入 DeepSeek / OpenAI / 智谱大模型 API。
- 在人工客服上线前或忙碌时，由 **AI 机器人基于企业知识库 (RAG)** 自动解答 80% 的常规咨询；当客户输入“人工”或不满时，无缝切入人工客服接管。

### 4.2 访客全轨迹跟踪与画像 (Visitor Trajectory)
- 自动记录访客的 IP 地理位置、设备系统、来源渠道（Referer）、在网站上的浏览停留历史（Visited Pages Timeline），方便客服第一时间了解客户意向。

---

## 五、 运维：结构化日志与可靠性 (Observability & Reliability)

### 5.1 结构化 JSON 日志 (Pino / Winston)
- 使用 `Pino` 或 `Winston` 输出结构化 JSON 日志，接入 ELK (Elasticsearch/Logstash/Kibana) 或 Datadog 日志分析平台。

### 5.2 优雅停机 (Graceful Shutdown)
- 监听 `SIGTERM` / `SIGINT` 信号，在发布更新重启时，暂停接收新 Socket 连接，通知现有连接断开重连，刷新 SQLite WAL 日志后再安全退出进程。

---

## 🛠️ 建议实施阶段划分

- **Phase 1 (组件化与 SDK 封装)**：开发 `widget.js`，实现 Iframe 悬浮窗口与 `postMessage` 通信桥梁。
- **Phase 2 (团队客服增强)**：实现多客服账号、智能分发、话术库与客服工作台。
- **Phase 3 (云化与分布式)**：集成 OSS 文件直传、PostgreSQL 迁移与 Redis 扩展。
- **Phase 4 (AI 智能体)**：集成 DeepSeek / RAG 知识库客服机器人。
