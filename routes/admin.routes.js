/**
 * Admin REST API Routes (routes/admin.routes.js)
 * Endpoints for admin authentication and sub-admin account management.
 */
const express = require('express');
const ChatDatabase = require('../db');

function createAdminRouter({ verifyAdminToken, signAdminToken, ADMIN_KEY, activeAdminsMap, io, broadcastAdminStatusToUsers }) {
  const router = express.Router();

  // Admin REST API Middleware
  function adminAuthMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader ? authHeader.replace(/^Bearer\s+/, '') : (req.headers['x-admin-token'] || req.body.token || req.query.token);
    const payload = verifyAdminToken(token);
    if (!payload) {
      return res.status(401).json({ success: false, message: '未授权或 Token 已过期，请重新登录' });
    }
    req.admin = payload;
    next();
  }

  function superAdminAuthMiddleware(req, res, next) {
    adminAuthMiddleware(req, res, () => {
      if (req.admin.role !== 'super_admin') {
        return res.status(403).json({ success: false, message: '权限不足：仅超级主管理可执行此操作' });
      }
      next();
    });
  }

  // REST API: Admin Login
  router.post('/login', (req, res) => {
    try {
      const { username, password, token } = req.body;

      if (token) {
        const verified = verifyAdminToken(token);
        if (verified && verified.username) {
          const dbAdmin = ChatDatabase.getAdminByUsername(verified.username);
          if (dbAdmin) {
            const newToken = signAdminToken(dbAdmin.username, dbAdmin.role);
            return res.json({
              success: true,
              token: newToken,
              username: dbAdmin.username,
              role: dbAdmin.role
            });
          }
        }
      }

      if (!username || !password) {
        if (password === ADMIN_KEY || username === ADMIN_KEY) {
          const superAdmin = ChatDatabase.getAllAdmins().find(a => a.role === 'super_admin') || ChatDatabase.getAdminByUsername('admin');
          if (superAdmin) {
            const newToken = signAdminToken(superAdmin.username, superAdmin.role);
            return res.json({
              success: true,
              token: newToken,
              username: superAdmin.username,
              role: superAdmin.role
            });
          }
        }
        return res.status(400).json({ success: false, message: '请输入管理员账号与密码' });
      }

      const admin = ChatDatabase.verifyAdminLogin(username.trim(), password);
      if (!admin) {
        return res.status(401).json({ success: false, message: '管理员账号或密码错误' });
      }

      const newToken = signAdminToken(admin.username, admin.role);
      res.json({
        success: true,
        token: newToken,
        username: admin.username,
        role: admin.role
      });
    } catch (err) {
      console.error('[ADMIN LOGIN ERROR]', err);
      res.status(500).json({ success: false, message: '服务端异常: ' + err.message });
    }
  });

  // REST API: Get All Admins (Super Admin Only)
  router.get('/list', superAdminAuthMiddleware, (req, res) => {
    try {
      const admins = ChatDatabase.getAllAdmins();
      res.json({ success: true, admins });
    } catch (err) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  // REST API: Create Sub-Admin (Super Admin Only)
  router.post('/create', superAdminAuthMiddleware, (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) {
        return res.status(400).json({ success: false, message: '用户名和密码不能为空' });
      }
      const cleanUser = username.trim();
      if (cleanUser.length < 3 || cleanUser.length > 20) {
        return res.status(400).json({ success: false, message: '用户名长度需在 3 到 20 个字符之间' });
      }
      if (password.length < 4) {
        return res.status(400).json({ success: false, message: '密码长度至少为 4 个字符' });
      }
      const newAdmin = ChatDatabase.createAdmin(cleanUser, password, 'admin');
      broadcastAdminStatusToUsers();
      res.json({ success: true, admin: newAdmin });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  // REST API: Delete Sub-Admin (Super Admin Only)
  router.post('/delete', superAdminAuthMiddleware, (req, res) => {
    try {
      const { username } = req.body;
      if (!username) {
        return res.status(400).json({ success: false, message: '缺少要删除的管理员用户名' });
      }
      const cleanUser = username.trim();
      ChatDatabase.deleteAdmin(cleanUser);

      if (activeAdminsMap.has(cleanUser)) {
        const adminSession = activeAdminsMap.get(cleanUser);
        if (adminSession && adminSession.sockets) {
          adminSession.sockets.forEach(sId => {
            const s = io.sockets.sockets.get(sId);
            if (s) {
              s.emit('admin-force-logout', { message: '您的管理员账号已被主管理删除' });
              s.disconnect(true);
            }
          });
        }
        activeAdminsMap.delete(cleanUser);
      }

      broadcastAdminStatusToUsers();
      res.json({ success: true, message: '已删除管理员账号' });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  // REST API: Update Admin Display Name (Super Admin Only)
  router.post('/update-display-name', superAdminAuthMiddleware, (req, res) => {
    try {
      const { username, displayName } = req.body;
      if (!username) {
        return res.status(400).json({ success: false, message: '缺少要更新的管理员用户名' });
      }
      const cleanUser = username.trim();
      const cleanName = (displayName || '').trim();
      ChatDatabase.updateAdminDisplayName(cleanUser, cleanName);

      broadcastAdminStatusToUsers();
      res.json({ success: true, message: '已更新管理员显示名称' });
    } catch (err) {
      res.status(400).json({ success: false, message: err.message });
    }
  });

  return router;
}

module.exports = createAdminRouter;
