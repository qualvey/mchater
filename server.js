const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const ChatDatabase = require('./db');
const Logger = require('./logger');
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

// JWT Token Generator & Verifier
const JWT_SECRET = crypto.randomBytes(32).toString('hex');

function signAdminToken(username, role = 'admin') {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ username, role, exp: Date.now() + 24 * 3600 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function verifyAdminToken(token) {
  try {
    if (!token || typeof token !== 'string') return null;
    const [header, payload, signature] = token.split('.');
    if (!header || !payload || !signature) return null;
    const expectedSig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${payload}`).digest('base64url');
    if (signature !== expectedSig) return null;
    const parsedPayload = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (parsedPayload.exp && Date.now() > parsedPayload.exp) return null;
    return parsedPayload;
  } catch (e) {
    return null;
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

// Load configuration file
let config = {
  port: 4000,
  hostname: '::',
  adminUsername: 'admin',
  adminKey: 'admin123',
  adminTriggerCode: 'admin888'
};

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

if (config.log && config.log.level) {
  Logger.setLevel(config.log.level);
}
Logger.info('LOGGER', `Logger initialized with level: '${Logger.getLevel()}'`);

const PORT = process.env.PORT || config.port;
const HOSTNAME = process.env.HOSTNAME || config.hostname;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || config.adminUsername || 'admin';
const ADMIN_KEY = process.env.ADMIN_KEY || config.adminKey;
const ADMIN_TRIGGER_CODE = process.env.ADMIN_TRIGGER_CODE || config.adminTriggerCode;

// Server state: Keyed by Client Device Fingerprint (clientId)
const activeUsers = new Map();
const activeAdminsMap = new Map();

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

// Helper to extract client IP address
function getClientIP(socket) {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return socket.handshake.address || (socket.request.connection && socket.request.connection.remoteAddress) || '127.0.0.1';
}

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

  activeAdminsMap.forEach(admRecord => {
    admRecord.sockets.forEach(adminSocketId => {
      io.to(adminSocketId).emit('update-user-list', userList);
    });
  });
}

function isAnyAdminOnline() {
  let count = 0;
  activeAdminsMap.forEach(adm => {
    if (adm.sockets && adm.sockets.size > 0) count += adm.sockets.size;
  });
  return count > 0;
}

function sendToAllAdmins(eventName, payload) {
  activeAdminsMap.forEach(admRecord => {
    admRecord.sockets.forEach(sId => {
      io.to(sId).emit(eventName, payload);
    });
  });
}

function getAdminListWithStatus() {
  try {
    const allAdmins = ChatDatabase.getAllAdmins();
    return allAdmins.map(a => {
      const activeSession = activeAdminsMap.get(a.username);
      const isOnline = Boolean(activeSession && activeSession.sockets && activeSession.sockets.size > 0);
      return {
        username: a.username,
        displayName: a.display_name || a.username,
        role: a.role,
        online: isOnline,
        lastLogin: a.last_login || a.created_at
      };
    });
  } catch (e) {
    return [];
  }
}

function broadcastAdminStatusToUsers(targetSocket = null) {
  const isAdminOnline = isAnyAdminOnline();
  const adminList = getAdminListWithStatus();
  const payload = { online: isAdminOnline, adminList: adminList };
  if (targetSocket) {
    targetSocket.emit('admin-status-change', payload);
  } else {
    io.emit('admin-status-change', payload);
  }
}

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

  activeAdminsMap.forEach((admRecord, username) => {
    const validSockets = new Set();
    admRecord.sockets.forEach(sId => {
      if (io.sockets.sockets.has(sId)) {
        validSockets.add(sId);
      }
    });

    if (admRecord.sockets.size !== validSockets.size) {
      admRecord.sockets = validSockets;
      if (validSockets.size === 0) {
        activeAdminsMap.delete(username);
      }
      stateChanged = true;
      console.log(`[CLEANUP ADMIN SOCKETS] Username: '${username}', Remaining: ${validSockets.size}`);
    }
  });

  if (stateChanged) {
    broadcastUserListToAdmins();
    broadcastAdminStatusToUsers();
  }
}, 15000);

// Mount Modular Express Routes
const publicRouter = createPublicRouter({
  isUploadRateLimited,
  activeUsers,
  sendToAllAdmins,
  getAdminListWithStatus,
  io
});
app.use('/api', publicRouter);

const adminRouter = createAdminRouter({
  verifyAdminToken,
  signAdminToken,
  ADMIN_USERNAME,
  ADMIN_KEY,
  activeAdminsMap,
  io,
  broadcastAdminStatusToUsers
});
app.use('/api/admin', adminRouter);

// Bind Modular Socket.IO Event Handlers
const socketContext = {
  activeUsers,
  activeAdminsMap,
  verifyAdminToken,
  signAdminToken,
  ADMIN_USERNAME,
  ADMIN_KEY,
  ADMIN_TRIGGER_CODE,
  getClientIP,
  isSocketRateLimited,
  isAnyAdminOnline,
  getAdminListWithStatus,
  broadcastUserListToAdmins,
  broadcastAdminStatusToUsers,
  sendToAllAdmins,
  handleUserDisconnect
};

io.on('connection', (socket) => {
  broadcastAdminStatusToUsers(socket);
  registerUserSocketHandlers(io, socket, socketContext);
  registerAdminSocketHandlers(io, socket, socketContext);
});

server.listen(PORT, HOSTNAME, () => {
  console.log(`=================================`);
  console.log(`💬 Chat Server running on http://${HOSTNAME}:${PORT}`);
  console.log(`👤 Admin Username: ${ADMIN_USERNAME}`);
  console.log(`🔑 Admin key: ${ADMIN_KEY}`);
  console.log(`🔐 Admin Trigger Secret: ${ADMIN_TRIGGER_CODE}`);
  console.log(`💾 SQLite Database connected: chat.db`);
  console.log(`=================================`);
});
