/**
 * Admin Socket Events Handler (sockets/admin.socket.js)
 * Manages admin join/auth, customer response routing, team internal chat, file approvals, and session deletions.
 */
const path = require('path');
const fs = require('fs');
const ChatDatabase = require('../db');

function registerAdminSocketHandlers(io, socket, context) {
  const {
    activeUsers,
    activeAdminsMap,
    verifyAdminToken,
    signAdminToken,
    ADMIN_KEY,
    ADMIN_TRIGGER_CODE,
    getAdminListWithStatus,
    broadcastAdminStatusToUsers,
    broadcastUserListToAdmins,
    sendToAllAdmins
  } = context;

  // 0. Verify Secret Trigger Code for Admin Access
  socket.on('verify-admin-trigger', ({ code }, callback) => {
    if (typeof callback !== 'function') return;
    if (!code || typeof code !== 'string') {
      return callback({ success: false });
    }
    const isMatched = code.trim().toLowerCase() === ADMIN_TRIGGER_CODE.trim().toLowerCase();
    callback({ success: isMatched });
  });

  // Fetch Admin List for User
  socket.on('get-admin-list', (callback) => {
    if (typeof callback === 'function') {
      callback({ success: true, adminList: getAdminListWithStatus() });
    }
  });

  // 1. Admin Join with JWT Token & Multi-Admin Support
  socket.on('join-admin', ({ username, password, token, secretKey }, callback) => {
    try {
      if (typeof callback !== 'function') return;
      let payload = null;

      if (token) {
        payload = verifyAdminToken(token);
      }

      if (!payload && username && password) {
        const verified = ChatDatabase.verifyAdminLogin(username.trim(), password);
        if (verified) {
          payload = { username: verified.username, role: verified.role };
        }
      }

      if (!payload && secretKey && secretKey === ADMIN_KEY) {
        payload = { username: 'admin', role: 'super_admin' };
      }

      if (!payload) {
        return callback({ success: false, message: '管理员鉴权失败：账号或密码错误或 Token 已失效' });
      }

      const adminToken = signAdminToken(payload.username, payload.role);
      socket.adminToken = adminToken;
      socket.adminUsername = payload.username;
      socket.adminRole = payload.role;
      socket.userRole = 'admin';

      let admRecord = activeAdminsMap.get(payload.username);
      if (!admRecord) {
        admRecord = { username: payload.username, role: payload.role, sockets: new Set() };
        activeAdminsMap.set(payload.username, admRecord);
      }
      admRecord.sockets.add(socket.id);

      const userList = Array.from(activeUsers.values()).map(u => ({
        clientId: u.clientId,
        nickname: u.nickname,
        reason: u.reason,
        joinedAt: u.joinedAt,
        online: Boolean(u.online && u.sockets && u.sockets.size > 0),
        lastSeen: u.lastSeen || u.joinedAt,
        lastIp: u.lastIp,
        nicknameHistory: u.nicknameHistory || [],
        ipHistory: u.ipHistory || []
      }));

      const allMessages = ChatDatabase.getAllMessagesGroupedByClient();
      const internalMessages = ChatDatabase.getAdminInternalMessages(payload.username);
      const adminList = getAdminListWithStatus();

      callback({
        success: true,
        token: socket.adminToken,
        username: payload.username,
        role: payload.role,
        users: userList,
        allMessages: allMessages,
        internalMessages: internalMessages,
        adminList: adminList
      });

      broadcastAdminStatusToUsers();
      console.log(`[ADMIN CONNECTED] Username: ${payload.username} (${payload.role}), Socket ID: ${socket.id}`);
    } catch (err) {
      console.error('[ADMIN JOIN ERROR]', err);
      if (typeof callback === 'function') {
        callback({ success: false, message: '服务端处理异常: ' + err.message });
      }
    }
  });

  // Admin to Admin Internal Messaging
  socket.on('admin-internal-message', ({ text, receiverUsername, timestamp, id }, callback) => {
    if (socket.userRole !== 'admin' || !socket.adminUsername) {
      return callback && callback({ success: false, message: '无管理员权限' });
    }

    const msgPayload = {
      id: id || Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      senderUsername: socket.adminUsername,
      receiverUsername: receiverUsername || 'ALL',
      text: text,
      timestamp: timestamp || new Date().toISOString()
    };

    ChatDatabase.saveAdminInternalMessage(msgPayload);

    let delivered = false;

    if (msgPayload.receiverUsername === 'ALL') {
      sendToAllAdmins('new-admin-internal-message', msgPayload);
      delivered = true;
    } else {
      const targetAdmin = activeAdminsMap.get(msgPayload.receiverUsername);
      if (targetAdmin && targetAdmin.sockets) {
        targetAdmin.sockets.forEach(sId => {
          io.to(sId).emit('new-admin-internal-message', msgPayload);
        });
        delivered = true;
      }

      const senderAdmin = activeAdminsMap.get(socket.adminUsername);
      if (senderAdmin && senderAdmin.sockets) {
        senderAdmin.sockets.forEach(sId => {
          if (msgPayload.receiverUsername !== socket.adminUsername) {
            io.to(sId).emit('new-admin-internal-message', msgPayload);
          }
        });
      }
    }

    if (callback) callback({ success: true, delivered });
  });

  // Admin Sends Message to Specific User (by targetClientId)
  socket.on('admin-message', ({ targetClientId, text, timestamp, id }, callback) => {
    if (socket.userRole !== 'admin') {
      return callback && callback({ success: false, message: '无管理员权限' });
    }

    const targetUser = activeUsers.get(targetClientId);
    const targetNickname = targetUser ? targetUser.nickname : '用户';
    const msgPayload = {
      id: id || Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      targetClientId: targetClientId,
      targetNickname: targetNickname,
      fromNickname: '管理员',
      text: text,
      timestamp: timestamp || new Date().toISOString(),
      senderRole: 'admin'
    };

    ChatDatabase.saveMessage(targetClientId, msgPayload);

    let delivered = false;
    if (targetUser && targetUser.online && targetUser.sockets.size > 0) {
      targetUser.sockets.forEach(sId => {
        io.to(sId).emit('new-admin-message', msgPayload);
      });
      delivered = true;
    }

    activeAdminsMap.forEach(admRecord => {
      admRecord.sockets.forEach(adminSocketId => {
        io.to(adminSocketId).emit('admin-message-sent', msgPayload);
      });
    });

    if (callback) {
      callback({
        success: true,
        delivered,
        message: delivered ? '消息已直接发送给用户' : '用户当前离线，已转发记录'
      });
    }
  });

  // Admin Delete Session or Clear Messages
  socket.on('admin-delete-session', ({ targetClientId }, callback) => {
    if (socket.userRole !== 'admin') {
      return callback && callback({ success: false, message: '无管理员权限' });
    }
    if (!targetClientId) {
      return callback && callback({ success: false, message: '目标设备ID缺失' });
    }

    const targetUser = activeUsers.get(targetClientId);
    if (targetUser && targetUser.sockets) {
      targetUser.sockets.forEach(sId => {
        io.to(sId).emit('session-deleted-by-admin');
      });
    }

    activeUsers.delete(targetClientId);
    ChatDatabase.deleteUserSession(targetClientId);
    broadcastUserListToAdmins();

    if (callback) callback({ success: true, message: '已彻底双向删除会话' });
  });

  socket.on('admin-clear-messages', ({ targetClientId }, callback) => {
    if (socket.userRole !== 'admin') {
      return callback && callback({ success: false, message: '无管理员权限' });
    }
    if (!targetClientId) {
      return callback && callback({ success: false, message: '目标设备ID缺失' });
    }

    const targetUser = activeUsers.get(targetClientId);
    if (targetUser && targetUser.sockets) {
      targetUser.sockets.forEach(sId => {
        io.to(sId).emit('session-cleared-by-admin');
      });
    }

    ChatDatabase.deleteUserMessages(targetClientId);

    if (callback) callback({ success: true, message: '已彻底双向清空该会话历史消息' });
  });

  // File Transfer Approval
  socket.on('admin-file-response', ({ msgId, targetClientId, approved }, callback) => {
    if (socket.userRole !== 'admin') {
      return callback && callback({ success: false, message: '无管理员权限' });
    }

    const dbMsg = ChatDatabase.getMessageById(msgId);
    if (!dbMsg) {
      return callback && callback({ success: false, message: '文件申请记录不存在' });
    }

    let fileData = {};
    try {
      fileData = JSON.parse(dbMsg.text);
    } catch (e) {
      return callback && callback({ success: false, message: '消息格式错误' });
    }

    fileData.fileStatus = approved ? 'approved' : 'rejected';
    const updatedText = JSON.stringify(fileData);
    ChatDatabase.updateMessageText(msgId, updatedText);

    const targetUser = activeUsers.get(targetClientId);
    const updatePayload = {
      msgId,
      targetClientId,
      approved,
      fileData
    };

    if (targetUser && targetUser.sockets) {
      targetUser.sockets.forEach(sId => {
        io.to(sId).emit('file-request-response', updatePayload);
      });
    }

    sendToAllAdmins('file-request-response', updatePayload);

    if (callback) {
      callback({ success: true });
    }
  });

  socket.on('file-upload-data', ({ msgId, targetClientId, fileName, fileDataUrl }, callback) => {
    try {
      const dbMsg = ChatDatabase.getMessageById(msgId);
      if (!dbMsg) {
        return callback && callback({ success: false, message: '未找到对应申请记录' });
      }

      const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const matches = fileDataUrl.match(/^data:(.+);base64,(.+)$/);
      let buffer;
      if (matches && matches[2]) {
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        buffer = Buffer.from(fileDataUrl);
      }

      const safeFileName = `${Date.now()}_${path.basename(fileName).replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
      const filePath = path.join(uploadsDir, safeFileName);
      fs.writeFileSync(filePath, buffer);

      const fileUrl = `/uploads/${safeFileName}`;

      let fileData = {};
      try {
        fileData = JSON.parse(dbMsg.text);
      } catch (e) { }

      fileData.fileStatus = 'completed';
      fileData.fileUrl = fileUrl;

      const updatedText = JSON.stringify(fileData);
      ChatDatabase.updateMessageText(msgId, updatedText);

      const payload = {
        msgId,
        targetClientId,
        fileUrl,
        fileData
      };

      const targetUser = activeUsers.get(targetClientId);
      if (targetUser && targetUser.sockets) {
        targetUser.sockets.forEach(sId => {
          io.to(sId).emit('file-upload-finished', payload);
        });
      }

      sendToAllAdmins('file-upload-finished', payload);

      if (callback) {
        callback({ success: true, fileUrl });
      }
    } catch (err) {
      console.error('[FILE UPLOAD ERROR]', err);
      if (callback) callback({ success: false, message: '保存文件失败' });
    }
  });

  // Typing Indicators
  socket.on('typing', ({ isTyping, targetClientId }) => {
    if (socket.userRole === 'user') {
      sendToAllAdmins('user-typing', {
        clientId: socket.clientId,
        nickname: socket.userNickname,
        isTyping: Boolean(isTyping)
      });
    } else if (socket.userRole === 'admin' && targetClientId) {
      const targetUser = activeUsers.get(targetClientId);
      if (targetUser && targetUser.online) {
        targetUser.sockets.forEach(sId => {
          io.to(sId).emit('admin-typing', { isTyping: Boolean(isTyping) });
        });
      }
    }
  });
}

module.exports = registerAdminSocketHandlers;
