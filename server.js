const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ChatDatabase = require('./db');
const createPublicRouter = require('./routes/public.routes');
const createAdminRouter = require('./routes/admin.routes');
const registerUserSocketHandlers = require('./sockets/user.socket');
const registerAdminSocketHandlers = require('./sockets/admin.socket');

const app = express();
app.set('trust proxy', true);
const server = http.createServer(app);

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});

// Load configuration file
let config = {
  port: 4000,
  hostname: '::',
  adminKey: 'admin123',
  adminTriggerCode: 'admin888'
};
// JWT Token Generator & Verifier
const JWT_SECRET = crypto.randomBytes(32).toString('hex');

function signAdminToken(username, role = 'admin') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ username, role: 'admin', exp: Date.now() + 24 * 3600 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyAdminToken(token) {
  try {
    if (!token || typeof token !== 'string') return false;
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) return false;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    if (signature !== expectedSig) return false;
    const parsedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsedPayload.exp && Date.now() > parsedPayload.exp) return false;
    return parsedPayload.role === 'admin';
  } catch (e) {
    return false;
  }
}

// Rate Limiter Maps
const uploadRateMap = new Map();
const socketRateMap = new Map();

function isUploadRateLimited(ip) {
  const now = Date.now();
  const windowMs = 60 * 1000;
  const maxRequests = 10;
  let timestamps = (uploadRateMap.get(ip) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) return true;
  timestamps.push(now);
  uploadRateMap.set(ip, timestamps);
  return false;
}

function isSocketRateLimited(key) {
  const now = Date.now();
  const windowMs = 1000;
  const maxRequests = 3;
  let timestamps = (socketRateMap.get(key) || []).filter(t => now - t < windowMs);
  if (timestamps.length >= maxRequests) return true;
  timestamps.push(now);
  socketRateMap.set(key, timestamps);
  return false;
}

// Socket.IO with fast 10s pingInterval & 5s pingTimeout, and 100MB maxHttpBufferSize
const io = new Server(server, {
  pingInterval: 10000,
  pingTimeout: 5000,
  maxHttpBufferSize: 1e8
});

// Configure Express Body Parser for uploads
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));


const configPath = path.join(__dirname, 'config.json');
try {
  if (fs.existsSync(configPath)) {
    const rawData = fs.readFileSync(configPath, 'utf8');
    config = { ...config, ...JSON.parse(rawData) };
    console.log('[CONFIG] Successfully loaded config.json');
  }
} catch (err) {
  console.warn('[CONFIG] Failed to load config.json, using defaults', err.message);
}

const PORT = process.env.PORT || config.port;
const HOSTNAME = process.env.HOSTNAME || config.hostname;
const ADMIN_KEY = process.env.ADMIN_KEY || config.adminKey;
const ADMIN_TRIGGER_CODE = process.env.ADMIN_TRIGGER_CODE || config.adminTriggerCode;

// Server state: Keyed by Client Device Fingerprint (clientId)
// activeUsers: clientId -> { clientId, nickname, reason, joinedAt, sockets: Set<socketId>, online: boolean, lastSeen: ISOString }
const activeUsers = new Map();
const adminSockets = new Set();

// Load persistent users from Database on startup
try {
  const dbUsers = ChatDatabase.getAllUsersWithHistory();
  dbUsers.forEach(u => {
    activeUsers.set(u.clientId, {
      clientId: u.clientId,
      nickname: u.nickname,
      reason: u.reason,
      joinedAt: u.createdAt,
      lastSeen: u.lastSeen,
      lastIp: u.lastIp,
      nicknameHistory: u.nicknameHistory || [],
      ipHistory: u.ipHistory || [],
      sockets: new Set(),
      online: false
    });
  });
  console.log(`[DATABASE] Loaded ${dbUsers.length} historical user device profiles from SQLite.`);
} catch (err) {
  console.error('[DATABASE] Failed to load users from DB:', err);
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// HTTP Upload Endpoint
const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv',
  'zip', 'rar', '7z', 'tar', 'gz', 'png', 'jpg', 'jpeg', 'gif', 'webp'
]);
const DANGEROUS_EXTENSIONS = new Set([
  'exe', 'bat', 'cmd', 'sh', 'php', 'asp', 'aspx', 'jsp', 'js', 'html', 'htm', 'vbs', 'ps1', 'cgi', 'pl', 'py'
]);

app.post('/api/upload', (req, res) => {
  try {
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
    if (isUploadRateLimited(clientIP)) {
      return res.status(429).json({ success: false, message: '上传频次过高，请 1 分钟后再试' });
    }

    const { fileName, fileDataUrl, msgId, targetClientId } = req.body;
    if (!fileName || !fileDataUrl) {
      return res.status(400).json({ success: false, message: '文件数据缺失' });
    }

    const ext = (fileName || '').split('.').pop().toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(ext) || !ALLOWED_EXTENSIONS.has(ext)) {
      return res.status(400).json({ success: false, message: '安全阻断：禁止上传可执行脚本或危险类型文件 (.' + ext + ')' });
    }

    const uploadsDir = path.join(__dirname, 'public', 'uploads');
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
    console.log(`[FILE UPLOAD SUCCESS] Saved ${safeFileName} to ${fileUrl}`);

    if (msgId && targetClientId) {
      const dbMsg = ChatDatabase.getMessageById(msgId);
      if (dbMsg) {
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

        adminSockets.forEach(adminSocketId => {
          io.to(adminSocketId).emit('file-upload-finished', payload);
        });
      }
    }

    return res.json({ success: true, fileUrl });
  } catch (err) {
    console.error('[API UPLOAD ERROR]', err);
    return res.status(500).json({ success: false, message: '保存文件失败: ' + err.message });
  }
});

// Helper to extract client IP address
function getClientIP(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address || (socket.request.connection && socket.request.connection.remoteAddress) || '127.0.0.1';
}

// Helper to broadcast updated user list to all connected admins
function broadcastUserListToAdmins() {
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

  adminSockets.forEach(adminSocketId => {
    io.to(adminSocketId).emit('update-user-list', userList);
  });
}

// Helper to broadcast admin online status to all users
function broadcastAdminStatusToUsers(targetSocket = null) {
  const isAdminOnline = adminSockets.size > 0;
  const payload = { online: isAdminOnline };
  if (targetSocket) {
    targetSocket.emit('admin-status-change', payload);
  } else {
    io.emit('admin-status-change', payload);
  }
}

// Disconnect helper
function handleUserDisconnect(socket) {
  if (!socket.clientId) return;
  const clientId = socket.clientId;
  const userRecord = activeUsers.get(clientId);
  if (userRecord) {
    userRecord.sockets.delete(socket.id);
    if (userRecord.sockets.size === 0) {
      userRecord.online = false;
      userRecord.lastSeen = new Date().toISOString();
      ChatDatabase.updateLastSeen(clientId);
      console.log(`[USER OFFLINE] ClientID: ${clientId}, Nickname: ${userRecord.nickname}`);
      broadcastUserListToAdmins();
    }
  }
}

// Periodic Garbage Collection / Heartbeat Cleanup (Every 15s)
setInterval(() => {
  let stateChanged = false;
  activeUsers.forEach((userRecord, clientId) => {
    const validSockets = new Set();
    userRecord.sockets.forEach(sId => {
      if (io.sockets.sockets.has(sId)) {
        validSockets.add(sId);
      }
    });

    if (userRecord.sockets.size !== validSockets.size) {
      userRecord.sockets = validSockets;
      if (userRecord.sockets.size === 0 && userRecord.online) {
        userRecord.online = false;
        userRecord.lastSeen = new Date().toISOString();
        ChatDatabase.updateLastSeen(clientId);
        stateChanged = true;
        console.log(`[CLEANUP OFFLINE] ClientID: ${clientId}`);
      }
    }
  });

  if (stateChanged) {
    broadcastUserListToAdmins();
  }
}, 15000);

io.on('connection', (socket) => {

  // Immediately send current admin status to newly connected client
  broadcastAdminStatusToUsers(socket);

  // 0. Verify Secret Trigger Code for Admin Access
  socket.on('verify-admin-trigger', ({ code }, callback) => {
    if (!code || typeof code !== 'string') {
      return callback({ success: false });
    }
    const isMatched = code.trim().toLowerCase() === ADMIN_TRIGGER_CODE.trim().toLowerCase();
    callback({ success: isMatched });
  });

  // 1. Check Nickname Availability
  socket.on('check-nickname', ({ nickname, clientId }, callback) => {
    if (!nickname || typeof nickname !== 'string') {
      return callback({ available: false, message: '请提供有效的昵称' });
    }

    const trimmed = nickname.trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      return callback({ available: false, message: '昵称长度需在 2 到 20 个字符之间' });
    }

    if (['admin', '管理员', '系统消息', 'system'].includes(trimmed.toLowerCase())) {
      return callback({ available: false, message: '该昵称是保留字，请换一个' });
    }

    // Check if another active device is currently using this nickname
    let isUsedByOther = false;
    activeUsers.forEach((userRecord, otherClientId) => {
      if (otherClientId !== clientId && userRecord.online && userRecord.sockets.size > 0) {
        if (userRecord.nickname.toLowerCase() === trimmed.toLowerCase()) {
          isUsedByOther = true;
        }
      }
    });

    if (isUsedByOther) {
      return callback({ available: false, message: '该昵称已被其他设备在线使用，请换一个' });
    }

    callback({ available: true });
  });

  // 2. User Join (Anchored by Client Fingerprint ID & Saved in SQLite)
  socket.on('join-user', ({ nickname, reason, clientId }, callback) => {
    if (!nickname || !reason || !clientId) {
      return callback({ success: false, message: '昵称、请求原因及设备ID不能为空' });
    }

    const trimmedNick = nickname.trim();
    const trimmedReason = reason.trim();
    const cleanClientId = String(clientId).trim();
    const clientIP = getClientIP(socket);

    if (['admin', '管理员', '系统消息', 'system'].includes(trimmedNick.toLowerCase())) {
      return callback({ success: false, message: '该昵称是保留字' });
    }

    // Record login into SQLite Database
    ChatDatabase.recordLogin(cleanClientId, trimmedNick, trimmedReason, clientIP);

    // Refresh memory object from SQLite details
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

    callback({
      success: true,
      user: {
        clientId: userRecord.clientId,
        nickname: userRecord.nickname,
        reason: userRecord.reason,
        joinedAt: userRecord.joinedAt,
        online: true
      },
      adminOnline: adminSockets.size > 0,
      historyMessages: historyMessages
    });

    broadcastUserListToAdmins();
    broadcastAdminStatusToUsers(socket);
    console.log(`[USER JOINED] ClientID: ${cleanClientId}, Nickname: ${trimmedNick}, IP: ${clientIP}`);
  });

  // 3. Admin Join with JWT Token Support
  socket.on('join-admin', ({ secretKey, token }, callback) => {
    try {
      if (typeof callback !== 'function') return;

      const isValidKey = secretKey && secretKey === ADMIN_KEY;
      const isValidToken = token && verifyAdminToken(token);

      if (!isValidKey && !isValidToken) {
        return callback({ success: false, message: '管理员密钥或身份 Token 无效' });
      }

      const adminToken = signAdminToken();
      socket.adminToken = adminToken;
      adminSockets.add(socket.id);
      socket.userRole = 'admin';

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

      callback({ success: true, token: socket.adminToken, users: userList, allMessages: allMessages });
      broadcastAdminStatusToUsers();
      console.log(`[ADMIN CONNECTED] Socket ID: ${socket.id}`);
    } catch (err) {
      console.error('[ADMIN JOIN ERROR]', err);
      if (typeof callback === 'function') {
        callback({ success: false, message: '服务端处理异常: ' + err.message });
      }
    }
  });

  // 4. User Sends Message to Admin
  socket.on('user-message', ({ text, timestamp, id }, callback) => {
    if (socket.userRole !== 'user' || !socket.clientId) {
      return callback && callback({ success: false, message: '未登录或身份非普通用户' });
    }

    if (isSocketRateLimited(socket.clientId)) {
      return callback && callback({ success: false, message: '发送频率过快，请稍后再试' });
    }

    const userRecord = activeUsers.get(socket.clientId);
    if (!userRecord) {
      return callback && callback({ success: false, message: '用户信息未找到' });
    }

    const msgPayload = {
      id: id || Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      clientId: socket.clientId,
      fromNickname: userRecord.nickname,
      reason: userRecord.reason,
      text: text,
      timestamp: timestamp || new Date().toISOString(),
      senderRole: 'user'
    };

    console.log(`[USER MESSAGE] From ${userRecord.nickname} (${socket.clientId}):`, text && text.length > 80 ? text.substring(0, 80) + '...' : text);

    // Save to SQLite DB
    ChatDatabase.saveMessage(socket.clientId, msgPayload);

    // Forward to all admins
    let deliveredToAdmin = false;
    adminSockets.forEach(adminSocketId => {
      io.to(adminSocketId).emit('new-user-message', msgPayload);
      deliveredToAdmin = true;
    });

    if (callback) {
      callback({
        success: true,
        delivered: deliveredToAdmin,
        message: deliveredToAdmin ? '消息已送达管理员' : '消息已保存，管理员当前可能离线'
      });
    }
  });

  // 5. Admin Sends Message to Specific User (by targetClientId)
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

    // Save to SQLite DB
    ChatDatabase.saveMessage(targetClientId, msgPayload);

    let delivered = false;
    if (targetUser && targetUser.online && targetUser.sockets.size > 0) {
      targetUser.sockets.forEach(sId => {
        io.to(sId).emit('new-admin-message', msgPayload);
      });
      delivered = true;
    }

    // Echo back to all admin sockets to sync multi-admin view
    adminSockets.forEach(adminSocketId => {
      io.to(adminSocketId).emit('admin-message-sent', msgPayload);
    });

    if (callback) {
      callback({
        success: true,
        delivered,
        message: delivered ? '消息已直接发送给用户' : '用户当前离线，已转发记录'
      });
    }
  });

  // Typing Status Event Forwarding
  socket.on('typing', ({ isTyping, targetClientId }) => {
    if (socket.userRole === 'user' && socket.clientId) {
      adminSockets.forEach(adminSocketId => {
        io.to(adminSocketId).emit('user-typing', {
          clientId: socket.clientId,
          nickname: socket.userNickname || '用户',
          isTyping: Boolean(isTyping)
        });
      });
    } else if (socket.userRole === 'admin' && targetClientId) {
      const targetUser = activeUsers.get(targetClientId);
      if (targetUser && targetUser.sockets) {
        targetUser.sockets.forEach(sId => {
          io.to(sId).emit('admin-typing', {
            isTyping: Boolean(isTyping)
          });
        });
      }
    }
  });

  // 6. Admin Delete Session or Clear Messages (Bilateral Deletion Broadcast)
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

  // 5.5 File Transfer Approval & Upload Handlers
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

    adminSockets.forEach(adminSocketId => {
      io.to(adminSocketId).emit('file-request-response', updatePayload);
    });

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

      const uploadsDir = path.join(__dirname, 'public', 'uploads');
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

      adminSockets.forEach(adminSocketId => {
        io.to(adminSocketId).emit('file-upload-finished', payload);
      });

      if (callback) {
        callback({ success: true, fileUrl });
      }
    } catch (err) {
      console.error('[FILE UPLOAD ERROR]', err);
      if (callback) callback({ success: false, message: '保存文件失败' });
    }
  });

  // 6. Typing Indicators
  socket.on('typing', ({ isTyping, targetClientId }) => {
    if (socket.userRole === 'user') {
      adminSockets.forEach(adminSocketId => {
        io.to(adminSocketId).emit('user-typing', {
          clientId: socket.clientId,
          nickname: socket.userNickname,
          isTyping
        });
      });
    } else if (socket.userRole === 'admin' && targetClientId) {
      const targetUser = activeUsers.get(targetClientId);
      if (targetUser && targetUser.online) {
        targetUser.sockets.forEach(sId => {
          io.to(sId).emit('admin-typing', { isTyping });
        });
      }
    }
  });

  // 7. Explicit Leave
  socket.on('leave-user', () => {
    handleUserDisconnect(socket);
  });

  // 8. Disconnect
  socket.on('disconnect', (reason) => {
    if (socket.userRole === 'admin') {
      adminSockets.delete(socket.id);
      console.log(`[ADMIN DISCONNECTED] Socket ID: ${socket.id}, Reason: ${reason}`);
      broadcastAdminStatusToUsers();
    } else if (socket.userRole === 'user') {
      handleUserDisconnect(socket);
    }
  });
});

server.listen(PORT, HOSTNAME, () => {
  console.log(`=================================`);
  console.log(`💬 Chat Server running on http://${HOSTNAME}:${PORT}`);
  console.log(`🔑 Admin key: ${ADMIN_KEY}`);
  console.log(`🔐 Admin Trigger Secret: ${ADMIN_TRIGGER_CODE}`);
  console.log(`💾 SQLite Database connected: chat.db`);
  console.log(`=================================`);
});
