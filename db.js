const Database = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, 'chat.db');
const db = new Database(dbPath);

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');

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
    timestamp TEXT NOT NULL
  );
`);

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
  INSERT OR IGNORE INTO messages (id, client_id, sender_role, sender_nickname, text, timestamp)
  VALUES (?, ?, ?, ?, ?, ?)
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
      msg.timestamp || new Date().toISOString()
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
      timestamp: m.timestamp
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
        timestamp: m.timestamp
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
}

module.exports = ChatDatabase;
