/**
 * Admin Socket Events Handler (sockets/admin.socket.js)
 * Manages admin join/auth, customer response routing, team internal chat, file approvals, and session deletions.
 */
const path = require('path');
const fs = require('fs');
const ChatDatabase = require('../db');
const Logger = require('../logger');

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
      Logger.debug('ADMIN_TRIGGER_VERIFY', `Invalid trigger code input from Socket ID: ${socket.id}`);
      return callback({ success: false });
    }
    const isMatched = code.trim().toLowerCase() === ADMIN_TRIGGER_CODE.trim().toLowerCase();
    Logger.info('ADMIN_TRIGGER_VERIFY', `Trigger secret code matched: ${isMatched} from Socket ID: ${socket.id}`);
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
        if (!payload) {
          Logger.warn('ADMIN_JOIN_FAILED', `Socket join-admin failed with invalid/expired token from Socket ID: ${socket.id}`);
        }
      }

      if (!payload && username && password) {
        const verified = ChatDatabase.verifyAdminLogin(username.trim(), password);
        if (verified) {
          payload = { username: verified.username, role: verified.role };
        } else {
          Logger.warn('ADMIN_JOIN_FAILED', `Socket join-admin failed for username: '${username}' from Socket ID: ${socket.id} - invalid password`);
        }
      }

      if (!payload && secretKey && secretKey === ADMIN_KEY) {
        const superAdmin = ChatDatabase.getAllAdmins().find(a => a.role === 'super_admin');
        const admUser = superAdmin ? superAdmin.username : 'admin';
        payload = { username: admUser, role: 'super_admin' };
      }

      if (!payload) {
        Logger.warn('ADMIN_JOIN_REJECTED', `Socket join-admin authentication failed from Socket ID: ${socket.id}`);
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
      Logger.info('ADMIN_CONNECTED', `Admin Connected -> Username: '${payload.username}' (${payload.role}), Socket ID: ${socket.id}`);
    } catch (err) {
      Logger.error('ADMIN_JOIN_ERROR', `Exception during socket join-admin:`, err);
      if (typeof callback === 'function') {
        callback({ success: false, message: '服务端处理异常: ' + err.message });
      }
    }
  });

  // Admin to Admin Internal Messaging
  socket.on('admin-internal-message', ({ text, receiverUsername, timestamp, id }, callback) => {
    if (socket.userRole !== 'admin' || !socket.adminUsername) {
      Logger.warn('ADMIN_INTERNAL_MSG_REJECTED', `Unauthorized internal message from Socket ID: ${socket.id}`);
      return callback && callback({ success: false, message: '无管理员权限' });
    }

    const msgPayload = {
      id: id || Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      senderUsername: socket.adminUsername,
      receiverUsername: receiverUsername || 'ALL',
      text: text,
      timestamp: timestamp || new Date().toISOString()
    };

    Logger.debug('ADMIN_INTERNAL_MSG', `Internal Msg From '${socket.adminUsername}' -> To '${msgPayload.receiverUsername}': ${text}`);

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
      Logger.warn('ADMIN_MSG_REJECTED', `Unauthorized admin-message attempt from Socket ID: ${socket.id}`);
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

    const textPreview = text && text.length > 80 ? text.substring(0, 80) + '...' : text;
    Logger.debug('ADMIN_MESSAGE', `Admin '${socket.adminUsername}' -> User '${targetNickname}' (${targetClientId}): ${textPreview}`);

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
      Logger.warn('ADMIN_DELETE_REJECTED', `Unauthorized delete session attempt from Socket ID: ${socket.id}`);
      return callback && callback({ success: false, message: '无管理员权限' });
    }
    if (!targetClientId) {
      return callback && callback({ success: false, message: '目标设备ID缺失' });
    }

    Logger.info('ADMIN_DELETE_SESSION', `Admin '${socket.adminUsername}' deleted session for ClientID: ${targetClientId}`);

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

    Logger.info('ADMIN_CLEAR_MESSAGES', `Admin '${socket.adminUsername}' cleared message history for ClientID: ${targetClientId}`);

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

    Logger.info('ADMIN_FILE_RESPONSE', `Admin '${socket.adminUsername}' ${approved ? 'APPROVED' : 'REJECTED'} file '${fileData.fileName}' for ClientID: ${targetClientId}`);

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
