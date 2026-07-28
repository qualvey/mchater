[x] 发送图片功能（支持拖动和粘贴）
[x] 发送任意文件功能，需要管理员侧同意后可以发送

## enhencement
[x] 整个聊天窗口都可以接受图片的拖动
[x] 消息队列机制，不在线时被发送的消息也能保存，在上线时被接受
[x] 聊天列表添加右键菜单，删除某个会话
[x] 双向同步删除机制（管理员侧删除/清空时，普通用户端实时擦除与离线同步抹除）

[x] 多管理员模式与主管理透视审计 (支持在线开户/注销与全局消息透视)
[x] 普通用户端动态客服选择列表 (支持切换沟通客服与消息定向精准路由)
[x] 用户退出登录后依然持久化保留上次输入的昵称与请求原因（自动预填充）
[x] 管理员之间可以互相通信 (支持团队内部公共大厅群聊与 1-对-1 客服私聊)

## security & commercial readiness (通用客服组件安全加固)
[x] 文件上传安全加固：严格白名单 (禁止 .exe, .bat, .sh, .php, .html 等可执行文件，防木马)
[x] 防刷屏与速率限制 (Rate Limiting)：防 DOS/CC 恶意刷消息与文件请求
[x] 跨站安全 (XSS / Iframe 嵌入防护)：强化 DOM 转义与安全 CSP 响应头
[x] 管理员 JWT Token 动态鉴权认证 (替代静态密码)
[x] 支持 Nginx 子路径反向代理与动态基准路径配置 (Universal BASE_PATH)
[x] 全面移动端响应式布局适配 (支持手机 100dvh 全屏与管理员双栏切屏)

## refactoring & modular architecture (模块化架构重构与解耦计划)
- [x] Phase 1.1: 拆分前端核心配置模块 (public/js/core/config.js) 与动态 API_BASE 转换器
- [x] Phase 1.2: 拆分前端通知与音效模块 (public/js/core/notif.js) 与桌面 Notification 调度器
- [ ] Phase 1.3: 拆分普通用户侧会话模块 (public/js/modules/user-chat.js)
- [ ] Phase 1.4: 拆分管理员-客户会话模块 (public/js/modules/admin-customer.js)
- [ ] Phase 1.5: 拆分管理员团队内部通信模块 (public/js/modules/admin-team.js)
- [ ] Phase 2.1: 拆分后端 REST API 路由分层 (routes/admin.routes.js & routes/public.routes.js)
- [ ] Phase 2.2: 拆分后端 Socket.IO 事件监听分层 (sockets/user.socket.js & sockets/admin.socket.js)
- [ ] Phase 3.1: 商业化一键嵌入式 Widget SDK 开发 (mychat-widget.js)