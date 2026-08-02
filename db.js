const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const dbPath = path.join(__dirname, 'chat.db');
const db = new DatabaseSync(dbPath);

db.pragma = function (sql) {
  return db.exec(`PRAGMA ${sql}`);
};

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

// Password Hashing Helpers
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHash] = storedHash.split(':');
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === originalHash;
}

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    client_id TEXT PRIMARY KEY,
    current_nickname TEXT NOT NULL,
    current_reason TEXT,
    created_at TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    last_ip TEXT
  );

  CREATE TABLE IF NOT EXISTS nickname_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    nickname TEXT NOT NULL,
    used_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS ip_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    ip_address TEXT NOT NULL,
    logged_in_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    sender_role TEXT NOT NULL,
    sender_nickname TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    target_admin TEXT
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at TEXT NOT NULL,
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS admin_messages (
    id TEXT PRIMARY KEY,
    sender_username TEXT NOT NULL,
    receiver_username TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS system_configs (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
`);

// Initialize default system configs if not present
try {
  const initEnabled = db.prepare("SELECT value FROM system_configs WHERE key = 'auto_reply_enabled'").get();
  if (!initEnabled) {
    db.prepare("INSERT INTO system_configs (key, value, updated_at) VALUES (?, ?, ?)").run('auto_reply_enabled', 'true', new Date().toISOString());
  }
  const initMode = db.prepare("SELECT value FROM system_configs WHERE key = 'auto_reply_mode'").get();
  if (!initMode) {
    db.prepare("INSERT INTO system_configs (key, value, updated_at) VALUES (?, ?, ?)").run('auto_reply_mode', 'first_and_followup', new Date().toISOString());
  }
  const initFirstMsg = db.prepare("SELECT value FROM system_configs WHERE key = 'auto_reply_first_message'").get();
  if (!initFirstMsg) {
    db.prepare("INSERT INTO system_configs (key, value, updated_at) VALUES (?, ?, ?)").run('auto_reply_first_message', '您好！欢迎首次咨询，当前暂无客服在线，您可以先在此留言描述您的问题，客服上线后会第一时间回复您！', new Date().toISOString());
  }
  const initFollowupMsg = db.prepare("SELECT value FROM system_configs WHERE key = 'auto_reply_followup_message'").get();
  if (!initFollowupMsg) {
    db.prepare("INSERT INTO system_configs (key, value, updated_at) VALUES (?, ?, ?)").run('auto_reply_followup_message', '您好，欢迎再次回来！客服目前暂时不在电脑前，已为您记录留言，请耐心等待回复！', new Date().toISOString());
  }
} catch (e) {
  console.error("[DB INIT] System configs init error:", e);
}

// Migration: Ensure display_name column exists in admins table
try {
  const adminCols = db.prepare("PRAGMA table_info(admins)").all();
  const hasDisplayName = adminCols.some(col => col.name === 'display_name');
  if (!hasDisplayName) {
    db.prepare("ALTER TABLE admins ADD COLUMN display_name TEXT;").run();
    console.log("[DB MIGRATION] Added 'display_name' column to 'admins' table.");
  }
} catch (e) {
  console.error("[DB MIGRATION ERROR]", e);
}

// Migration: Ensure target_admin column exists in messages table
try {
  const msgCols = db.prepare("PRAGMA table_info(messages)").all();
  const hasTargetAdmin = msgCols.some(col => col.name === 'target_admin');
  if (!hasTargetAdmin) {
    db.prepare("ALTER TABLE messages ADD COLUMN target_admin TEXT;").run();
    console.log("[DB MIGRATION] Added 'target_admin' column to 'messages' table.");
  }
} catch (e) {
  console.error("[DB MIGRATION ERROR]", e);
}

// Ensure super_admin credentials sync with config.json
let cfgAdminUsername = 'admin';
let cfgAdminKey = 'admin123';
try {
  const cfgPath = path.join(__dirname, 'config.json');
  if (fs.existsSync(cfgPath)) {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    if (cfg.adminUsername) cfgAdminUsername = cfg.adminUsername.trim();
    if (cfg.adminKey) cfgAdminKey = cfg.adminKey;
  }
} catch (e) {}

const superAdminRecord = db.prepare("SELECT * FROM admins WHERE role = 'super_admin' LIMIT 1").get();
const nowStr = new Date().toISOString();
const superPwdHash = hashPassword(cfgAdminKey);

if (!superAdminRecord) {
  db.prepare(`
    INSERT INTO admins (username, password_hash, role, created_at)
    VALUES (?, ?, ?, ?)
  `).run(cfgAdminUsername, superPwdHash, 'super_admin', nowStr);
  console.log(`[DB INIT] Initialized super admin '${cfgAdminUsername}' from config.json.`);
} else {
  db.prepare(`
    UPDATE admins
    SET username = ?, password_hash = ?
    WHERE id = ?
  `).run(cfgAdminUsername, superPwdHash, superAdminRecord.id);
}

// Prepared Statements
const stmtGetUser = db.prepare('SELECT * FROM users WHERE client_id = ?');
const stmtInsertUser = db.prepare(`
  INSERT INTO users (client_id, current_nickname, current_reason, created_at, last_seen, last_ip)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const stmtUpdateUser = db.prepare(`
  UPDATE users 
  SET current_nickname = ?, current_reason = ?, last_seen = ?, last_ip = ?
  WHERE client_id = ?
`);

const stmtGetLastNickname = db.prepare('SELECT nickname FROM nickname_history WHERE client_id = ? ORDER BY id DESC LIMIT 1');
const stmtInsertNicknameHistory = db.prepare(`
  INSERT INTO nickname_history (client_id, nickname, used_at)
  VALUES (?, ?, ?)
`);
const stmtGetNicknameHistory = db.prepare('SELECT nickname, used_at FROM nickname_history WHERE client_id = ? ORDER BY id ASC');

const stmtGetLastIP = db.prepare('SELECT ip_address FROM ip_history WHERE client_id = ? ORDER BY id DESC LIMIT 1');
const stmtInsertIPHistory = db.prepare(`
  INSERT INTO ip_history (client_id, ip_address, logged_in_at)
  VALUES (?, ?, ?)
`);
const stmtGetIPHistory = db.prepare('SELECT ip_address, logged_in_at FROM ip_history WHERE client_id = ? ORDER BY id ASC');

const stmtInsertMessage = db.prepare(`
  INSERT OR IGNORE INTO messages (id, client_id, sender_role, sender_nickname, text, timestamp, target_admin)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const stmtGetMessages = db.prepare('SELECT * FROM messages WHERE client_id = ? ORDER BY timestamp ASC');

const stmtGetAllUsers = db.prepare('SELECT * FROM users ORDER BY last_seen DESC');

/**
 * DB Manager Module
 */
class ChatDatabase {
  // Record or update user connection, nickname history, and IP history
  static recordLogin(clientId, nickname, reason, ipAddress) {
    const now = new Date().toISOString();
    const existing = stmtGetUser.get(clientId);

    if (!existing) {
      // First time user
      stmtInsertUser.run(clientId, nickname, reason, now, now, ipAddress);
      stmtInsertNicknameHistory.run(clientId, nickname, now);
      stmtInsertIPHistory.run(clientId, ipAddress, now);
    } else {
      // Update existing user
      stmtUpdateUser.run(nickname, reason, now, ipAddress, clientId);

      // Check if nickname changed
      const lastNick = stmtGetLastNickname.get(clientId);
      if (!lastNick || lastNick.nickname !== nickname) {
        stmtInsertNicknameHistory.run(clientId, nickname, now);
      }

      // Check if IP changed
      const lastIp = stmtGetLastIP.get(clientId);
      if (!lastIp || lastIp.ip_address !== ipAddress) {
        stmtInsertIPHistory.run(clientId, ipAddress, now);
      }
    }
  }

  // Update user last seen
  static updateLastSeen(clientId) {
    const now = new Date().toISOString();
    db.prepare('UPDATE users SET last_seen = ? WHERE client_id = ?').run(now, clientId);
  }

  // Fetch full details of a user including nickname history & IP history
  static getUserDetails(clientId) {
    const user = stmtGetUser.get(clientId);
    if (!user) return null;

    const nicknameHistory = stmtGetNicknameHistory.all(clientId);
    const ipHistory = stmtGetIPHistory.all(clientId);

    return {
      user,
      nicknameHistory,
      ipHistory
    };
  }

  // Fetch all users with their history for Admin Dashboard
  static getAllUsersWithHistory() {
    const users = stmtGetAllUsers.all();
    return users.map(u => {
      const nicknames = stmtGetNicknameHistory.all(u.client_id);
      const ips = stmtGetIPHistory.all(u.client_id);
      return {
        clientId: u.client_id,
        nickname: u.current_nickname,
        reason: u.current_reason,
        createdAt: u.created_at,
        lastSeen: u.last_seen,
        lastIp: u.last_ip,
        nicknameHistory: nicknames,
        ipHistory: ips
      };
    });
  }

  // Messages persistence
  static saveMessage(clientId, msg) {
    stmtInsertMessage.run(
      msg.id,
      clientId,
      msg.senderRole || 'user',
      msg.fromNickname || '未知',
      msg.text,
      msg.timestamp || new Date().toISOString(),
      msg.targetAdmin || msg.targetAdminUsername || null
    );
  }

  static getMessages(clientId) {
    const msgs = stmtGetMessages.all(clientId);
    return msgs.map(m => ({
      id: m.id,
      clientId: m.client_id,
      senderRole: m.sender_role,
      fromNickname: m.sender_nickname,
      text: m.text,
      timestamp: m.timestamp,
      targetAdmin: m.target_admin || null
    }));
  }

  static getAllMessagesGroupedByClient() {
    const allMsgs = db.prepare('SELECT * FROM messages ORDER BY timestamp ASC').all();
    const map = {};
    allMsgs.forEach(m => {
      if (!map[m.client_id]) map[m.client_id] = [];
      map[m.client_id].push({
        id: m.id,
        clientId: m.client_id,
        senderRole: m.sender_role,
        fromNickname: m.sender_nickname,
        text: m.text,
        timestamp: m.timestamp,
        targetAdmin: m.target_admin || null
      });
    });
    return map;
  }

  static updateMessageText(id, newText) {
    db.prepare('UPDATE messages SET text = ? WHERE id = ?').run(newText, id);
  }

  static getMessageById(id) {
    return db.prepare('SELECT * FROM messages WHERE id = ?').get(id);
  }

  static deleteUserMessages(clientId) {
    db.prepare('DELETE FROM messages WHERE client_id = ?').run(clientId);
  }

  static deleteUserSession(clientId) {
    db.prepare('DELETE FROM messages WHERE client_id = ?').run(clientId);
    db.prepare('DELETE FROM users WHERE client_id = ?').run(clientId);
    db.prepare('DELETE FROM nickname_history WHERE client_id = ?').run(clientId);
    db.prepare('DELETE FROM ip_history WHERE client_id = ?').run(clientId);
  }

  // Admin Management Static Methods
  static verifyAdminLogin(username, password) {
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin) return null;
    const isValid = verifyPassword(password, admin.password_hash);
    if (!isValid) return null;

    const now = new Date().toISOString();
    db.prepare('UPDATE admins SET last_login = ? WHERE username = ?').run(now, username);
    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.display_name || admin.username,
      role: admin.role,
      createdAt: admin.created_at,
      lastLogin: now
    };
  }

  static getAdminByUsername(username) {
    const admin = db.prepare('SELECT id, username, display_name, role, created_at, last_login FROM admins WHERE username = ?').get(username);
    if (!admin) return null;
    return {
      id: admin.id,
      username: admin.username,
      displayName: admin.display_name || admin.username,
      role: admin.role,
      createdAt: admin.created_at,
      lastLogin: admin.last_login
    };
  }

  static getAllAdmins() {
    return db.prepare('SELECT id, username, display_name, role, created_at, last_login FROM admins ORDER BY id ASC').all();
  }

  static updateAdminDisplayName(username, displayName) {
    const cleanUser = String(username || '').trim();
    const cleanName = String(displayName || '').trim();
    const result = db.prepare('UPDATE admins SET display_name = ? WHERE username = ?').run(cleanName || cleanUser, cleanUser);
    if (result.changes === 0) {
      throw new Error('管理员账号不存在');
    }
    return true;
  }

  static createAdmin(username, password, role = 'admin') {
    const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
    if (existing) {
      throw new Error('管理员用户名已存在');
    }
    const pwdHash = hashPassword(password);
    const now = new Date().toISOString();
    const result = db.prepare(`
      INSERT INTO admins (username, password_hash, role, created_at)
      VALUES (?, ?, ?, ?)
    `).run(username, pwdHash, role, now);
    return {
      id: result.lastInsertRowid,
      username,
      role,
      createdAt: now
    };
  }

  static deleteAdmin(username) {
    const admin = db.prepare('SELECT role FROM admins WHERE username = ?').get(username);
    if (!admin) {
      throw new Error('管理员账号不存在');
    }
    if (admin.role === 'super_admin') {
      throw new Error('禁止删除超级主管理账号');
    }
    db.prepare('DELETE FROM admins WHERE username = ?').run(username);
    return true;
  }

  static updateAdminPassword(username, oldPassword, newPassword) {
    const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
    if (!admin) {
      throw new Error('管理员账号不存在');
    }
    if (admin.role === 'super_admin') {
      throw new Error('超级主管理员密码由 config.json 配置文件管理，无法在此修改');
    }
    if (!verifyPassword(oldPassword, admin.password_hash)) {
      throw new Error('原密码输入错误');
    }
    if (!newPassword || String(newPassword).length < 4) {
      throw new Error('新密码长度至少为 4 个字符');
    }
    const newHash = hashPassword(newPassword);
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(newHash, admin.id);
    return true;
  }

  // Admin Internal Messages Persistence
  static saveAdminInternalMessage(msg) {
    db.prepare(`
      INSERT OR IGNORE INTO admin_messages (id, sender_username, receiver_username, text, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      msg.id,
      msg.senderUsername,
      msg.receiverUsername || 'ALL',
      msg.text,
      msg.timestamp || new Date().toISOString()
    );
  }

  static getAdminInternalMessages(username) {
    const msgs = db.prepare(`
      SELECT * FROM admin_messages
      WHERE receiver_username = 'ALL'
         OR receiver_username = ?
         OR sender_username = ?
      ORDER BY timestamp ASC
    `).all(username, username);

    return msgs.map(m => ({
      id: m.id,
      senderUsername: m.sender_username,
      receiverUsername: m.receiver_username,
      text: m.text,
      timestamp: m.timestamp
    }));
  }

  // System Config & Auto Reply Settings
  static getSystemConfig(key, defaultValue = '') {
    try {
      const record = db.prepare('SELECT value FROM system_configs WHERE key = ?').get(key);
      return record ? record.value : defaultValue;
    } catch (e) {
      return defaultValue;
    }
  }

  static setSystemConfig(key, value) {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO system_configs (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(key, String(value), now);
  }

  static getAutoReplyConfig() {
    const enabledStr = ChatDatabase.getSystemConfig('auto_reply_enabled', 'true');
    const mode = ChatDatabase.getSystemConfig('auto_reply_mode', 'first_and_followup');
    const firstMessage = ChatDatabase.getSystemConfig(
      'auto_reply_first_message',
      ChatDatabase.getSystemConfig('auto_reply_message', '您好！欢迎首次咨询，当前暂无客服在线，您可以先在此留言描述您的问题，客服上线后会第一时间回复您！')
    );
    const followupMessage = ChatDatabase.getSystemConfig(
      'auto_reply_followup_message',
      '您好，欢迎再次回来！客服目前暂时不在电脑前，已为您记录留言，请耐心等待回复！'
    );
    return {
      enabled: enabledStr === 'true',
      mode: mode, // 'first_only' | 'always_same' | 'first_and_followup'
      firstMessage: firstMessage,
      followupMessage: followupMessage,
      message: firstMessage
    };
  }

  static updateAutoReplyConfig({ enabled, mode, firstMessage, followupMessage, message }) {
    if (typeof enabled === 'boolean') {
      ChatDatabase.setSystemConfig('auto_reply_enabled', enabled ? 'true' : 'false');
    }
    if (typeof mode === 'string' && ['first_only', 'always_same', 'first_and_followup'].includes(mode)) {
      ChatDatabase.setSystemConfig('auto_reply_mode', mode);
    }
    const cleanFirst = typeof firstMessage === 'string' ? firstMessage.trim() : (typeof message === 'string' ? message.trim() : null);
    if (cleanFirst !== null && cleanFirst !== '') {
      ChatDatabase.setSystemConfig('auto_reply_first_message', cleanFirst);
      ChatDatabase.setSystemConfig('auto_reply_message', cleanFirst);
    }
    if (typeof followupMessage === 'string' && followupMessage.trim() !== '') {
      ChatDatabase.setSystemConfig('auto_reply_followup_message', followupMessage.trim());
    }
    return ChatDatabase.getAutoReplyConfig();
  }
}

module.exports = ChatDatabase;
