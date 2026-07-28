# MyChat 模块化架构重构计划与当前进度文档 (Refactoring Plan & Progress Doc)

## 📌 重构目标 (Refactoring Goals)
1. **解除巨型单文件依赖**：把 `public/js/app.js` (~2200 行) 与 `server.js` (~1060 行) 拆分为职责明确的原生 ES 模块与后端分层。
2. **零构建工具负担**：保持前端纯原生 HTML/CSS/JS (Native ES Modules)，不引入复杂的 Vue/React 打包工具链，确保开箱即用与极速加载。
3. **商业化与嵌入式解耦**：为未来第三方官网一键引入 Floating Bubble 聊天 Widget SDK (`mychat-widget.js`) 打下解耦基础。

---

## 🗺️ 重构路线图与最新进度 (Roadmap & Status)

### 阶段一：前端 Native ES Modules 模块化拆分 (Frontend Modularization)

- [x] **Phase 1.1: 核心配置与基准路径解析**
  - **文件**: [`public/js/core/config.js`](file:///c:/Users/Ryu/Documents/workspace/mychat/public/js/core/config.js)
  - **状态**: ✅ 已完成 (Commit: `bfef89f`)
  - **功能**: 提供 `MYCHAT_BASE_PATH` 自动计算、`API_BASE` 导出与 `formatApiUrl` 转换器。

- [x] **Phase 1.2: 提示音与桌面 Notification 调度**
  - **文件**: [`public/js/core/notif.js`](file:///c:/Users/Ryu/Documents/workspace/mychat/public/js/core/notif.js)
  - **状态**: ✅ 已完成 (Commit: `bfef89f`)
  - **功能**: 提供 Web Audio API 合成音效播放与桌面 Notification 通知分发。

- [ ] **Phase 1.3: 普通用户侧会话控制器**
  - **文件**: `public/js/modules/user-chat.js`
  - **状态**: ⏳ 计划中
  - **功能**: 隔离普通用户端消息发送、历史同步与专属客服下拉选择器。

- [ ] **Phase 1.4: 管理员-客户会话控制器**
  - **文件**: `public/js/modules/admin-customer.js`
  - **状态**: ⏳ 计划中
  - **功能**: 隔离管理员侧客户列表渲染、历史追溯、文件审核与开户/销户 Modal。

- [ ] **Phase 1.5: 管理员团队内部通信控制器**
  - **文件**: `public/js/modules/admin-team.js`
  - **状态**: ⏳ 计划中
  - **功能**: 隔离管理员团队内部大厅群聊、1-对-1 客服私聊与 Sidebar Tab 调度。

---

### 阶段二：后端路由与 Socket 分层拆分 (Backend Separation)

- [ ] **Phase 2.1: REST API 路由拆分**
  - **文件**: `routes/admin.routes.js`, `routes/public.routes.js`
  - **状态**: ⏳ 计划中
  - **功能**: 将管理员鉴权/管理接口与公共/文件上传接口从 `server.js` 中抽离。

- [ ] **Phase 2.2: Socket.IO 事件分层**
  - **文件**: `sockets/user.socket.js`, `sockets/admin.socket.js`
  - **状态**: ⏳ 计划中
  - **功能**: 将用户端 Socket 监听与管理员端 Socket 监听按角色分文件响应。

---

### 阶段三：商业化嵌入 SDK 与多分组拓展 (Commercial SDK)

- [ ] **Phase 3.1: 浮窗嵌入式 SDK 开发**
  - **文件**: `public/js/mychat-widget.js`
  - **状态**: ⏳ 计划中
  - **功能**: 支持在任何第三方网站通过一句话 HTML `<script>` 标签生成右下角悬浮客服气泡。
