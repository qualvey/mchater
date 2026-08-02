/**
 * User Socket Events Handler (sockets/user.socket.js)
 * Manages user connections, nickname checks, join events, message routing, and typing indicators.
 */
const ChatDatabase = require('../db');
const Logger = require('../logger');
const AutoReplyService = require('../services/autoReply.service');

function registerUserSocketHandlers(io, socket, context) {
  const {
    activeUsers,
    activeAdminsMap,
    getClientIP,
    isSocketRateLimited,
    isAnyAdminOnline,
    getAdminListWithStatus,
    broadcastUserListToAdmins,
    broadcastAdminStatusToUsers,
    sendToAllAdmins,
    handleUserDisconnect
  } = context;

  // 1. Check Nickname Availability
  socket.on('check-nickname', ({ nickname, clientId }, callback) => {
    if (typeof callback !== 'function') return;
    if (!nickname || typeof nickname !== 'string') {
      Logger.debug('USER_NICK_CHECK', `Invalid nickname string check from ClientID: ${clientId}`);
      return callback({ available: false, message: '请提供有效的昵称' });
    }

    const trimmed = nickname.trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      Logger.debug('USER_NICK_CHECK', `Nickname length out of bounds: '${trimmed}'`);
      return callback({ available: false, message: '昵称长度需在 2 到 20 个字符之间' });
    }

    if (['admin', '管理员', '系统消息', 'system'].includes(trimmed.toLowerCase())) {
      Logger.debug('USER_NICK_CHECK', `Reserved nickname requested: '${trimmed}'`);
      return callback({ available: false, message: '该昵称是保留字，请换一个' });
    }

    let isUsedByOther = false;
    activeUsers.forEach((userRecord, otherClientId) => {
      if (otherClientId !== clientId && userRecord.online && userRecord.sockets.size > 0) {
        if (userRecord.nickname.toLowerCase() === trimmed.toLowerCase()) {
          isUsedByOther = true;
        }
      }
    });

    if (isUsedByOther) {
      Logger.debug('USER_NICK_CHECK', `Nickname '${trimmed}' is already in use by another active device`);
      return callback({ available: false, message: '该昵称已被其他设备在线使用，请换一个' });
    }

    callback({ available: true });
  });

  // 2. User Join
  socket.on('join-user', ({ nickname, reason, clientId }, callback) => {
    if (typeof callback !== 'function') return;
    const clientIP = getClientIP(socket);

    if (!nickname || !reason || !clientId) {
      Logger.warn('USER_JOIN_FAILED', `Missing required join fields from IP: ${clientIP}`);
      return callback({ success: false, message: '昵称、请求原因及设备ID不能为空' });
    }

    const trimmedNick = nickname.trim();
    const trimmedReason = reason.trim();
    const cleanClientId = String(clientId).trim();

    if (['admin', '管理员', '系统消息', 'system'].includes(trimmedNick.toLowerCase())) {
      Logger.warn('USER_JOIN_FAILED', `Reserved nickname '${trimmedNick}' attempted by IP: ${clientIP}`);
      return callback({ success: false, message: '该昵称是保留字' });
    }

    ChatDatabase.recordLogin(cleanClientId, trimmedNick, trimmedReason, clientIP);

    const dbDetails = ChatDatabase.getUserDetails(cleanClientId);
    let userRecord = activeUsers.get(cleanClientId);

    if (!userRecord) {
      userRecord = {
        clientId: cleanClientId,
        nickname: trimmedNick,
        reason: trimmedReason,
        joinedAt: dbDetails.user.created_at,
        lastSeen: dbDetails.user.last_seen,
        lastIp: clientIP,
        nicknameHistory: dbDetails.nicknameHistory || [],
        ipHistory: dbDetails.ipHistory || [],
        sockets: new Set(),
        online: true
      };
      activeUsers.set(cleanClientId, userRecord);
    } else {
      userRecord.nickname = trimmedNick;
      userRecord.reason = trimmedReason;
      userRecord.lastIp = clientIP;
      userRecord.online = true;
      userRecord.nicknameHistory = dbDetails ? dbDetails.nicknameHistory : userRecord.nicknameHistory;
      userRecord.ipHistory = dbDetails ? dbDetails.ipHistory : userRecord.ipHistory;
    }

    userRecord.sockets.add(socket.id);
    socket.clientId = cleanClientId;
    socket.userNickname = trimmedNick;
    socket.userRole = 'user';

    const historyMessages = ChatDatabase.getMessages(cleanClientId);
    const isNewUser = (!historyMessages || historyMessages.length === 0);

    const autoReplyMsg = AutoReplyService.triggerOfflineReplyIfNeeded({
      clientId: cleanClientId,
      historyMessages: historyMessages,
      isNewUser: isNewUser,
      isAnyAdminOnline: isAnyAdminOnline()
    });

    if (autoReplyMsg) {
      historyMessages.push(autoReplyMsg);
    }

    callback({
      success: true,
      user: {
        clientId: userRecord.clientId,
        nickname: userRecord.nickname,
        reason: userRecord.reason,
        joinedAt: userRecord.joinedAt,
        online: true
      },
      adminOnline: isAnyAdminOnline(),
      adminList: getAdminListWithStatus(),
      historyMessages: historyMessages
    });

    broadcastUserListToAdmins();
    broadcastAdminStatusToUsers(socket);
    Logger.info('USER_JOINED', `User Joined -> ClientID: ${cleanClientId}, Nickname: '${trimmedNick}', Reason: '${trimmedReason}', IP: ${clientIP}`);
  });

  // 3. User Sends Message
  socket.on('user-message', ({ text, timestamp, id, targetAdminUsername }, callback) => {
    if (socket.userRole !== 'user' || !socket.clientId) {
      Logger.warn('USER_MSG_REJECTED', `Unauthenticated message attempt from Socket ID: ${socket.id}`);
      return callback && callback({ success: false, message: '未登录或身份非普通用户' });
    }

    if (isSocketRateLimited(socket.clientId)) {
      Logger.warn('USER_RATE_LIMITED', `Message rate limit hit for ClientID: ${socket.clientId}`);
      return callback && callback({ success: false, message: '发送频率过快，请稍后再试' });
    }

    const userRecord = activeUsers.get(socket.clientId);
    if (!userRecord) {
      Logger.warn('USER_MSG_REJECTED', `User profile not found for ClientID: ${socket.clientId}`);
      return callback && callback({ success: false, message: '用户信息未找到' });
    }

    const msgPayload = {
      id: id || Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      clientId: socket.clientId,
      fromNickname: userRecord.nickname,
      reason: userRecord.reason,
      text: text,
      timestamp: timestamp || new Date().toISOString(),
      senderRole: 'user',
      targetAdmin: targetAdminUsername || null
    };

    const textPreview = text && text.length > 80 ? text.substring(0, 80) + '...' : text;
    Logger.debug('USER_MESSAGE', `From '${userRecord.nickname}' (${socket.clientId}) -> Target: '${targetAdminUsername || 'ALL'}': ${textPreview}`);

    ChatDatabase.saveMessage(socket.clientId, msgPayload);

    let deliveredToAdmin = false;

    if (targetAdminUsername) {
      const targetAdmRecord = activeAdminsMap.get(targetAdminUsername);
      if (targetAdmRecord && targetAdmRecord.sockets && targetAdmRecord.sockets.size > 0) {
        targetAdmRecord.sockets.forEach(sId => {
          io.to(sId).emit('new-user-message', msgPayload);
          deliveredToAdmin = true;
        });
      }
      activeAdminsMap.forEach(admRecord => {
        if (admRecord.role === 'super_admin' && admRecord.username !== targetAdminUsername) {
          admRecord.sockets.forEach(sId => {
            io.to(sId).emit('new-user-message', msgPayload);
            deliveredToAdmin = true;
          });
        }
      });
    } else {
      activeAdminsMap.forEach(admRecord => {
        admRecord.sockets.forEach(sId => {
          io.to(sId).emit('new-user-message', msgPayload);
          deliveredToAdmin = true;
        });
      });
    }

    if (callback) {
      callback({
        success: true,
        delivered: deliveredToAdmin,
        message: deliveredToAdmin ? '消息已送达管理员' : '消息已保存，管理员当前可能离线'
      });
    }
  });

  // 4. Leave User
  socket.on('leave-user', () => {
    Logger.info('USER_LEFT', `User explicit leave for ClientID: ${socket.clientId || 'Unknown'}`);
    handleUserDisconnect(socket);
  });
}

module.exports = registerUserSocketHandlers;
