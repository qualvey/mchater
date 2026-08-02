/**
 * Offline Auto Reply Service (services/autoReply.service.js)
 * Manages automatic reply messages when new users join or send messages when no admin/agent is online.
 */
const ChatDatabase = require('../db');
const Logger = require('../logger');

class AutoReplyService {
  /**
   * Check conditions and trigger an offline auto-reply message if appropriate.
   * @param {Object} params
   * @param {string} params.clientId - Client ID of the user.
   * @param {Array} [params.historyMessages] - Array of existing history messages.
   * @param {boolean} [params.isNewUser] - Whether this user has no prior chat history.
   * @param {boolean} params.isAnyAdminOnline - Whether any admin is currently online.
   * @returns {Object|null} The auto reply message object if sent, otherwise null.
   */
  static triggerOfflineReplyIfNeeded({ clientId, historyMessages = [], isNewUser = false, isAnyAdminOnline }) {
    // 1. Only trigger if no admin is online
    if (isAnyAdminOnline) {
      return null;
    }

    // 2. Read auto-reply configuration from DB
    const config = ChatDatabase.getAutoReplyConfig();
    if (!config || !config.enabled) {
      Logger.debug('AUTO_REPLY_SKIPPED', `Auto reply disabled for ClientID: ${clientId}`);
      return null;
    }

    const hasHistory = Array.isArray(historyMessages) && historyMessages.length > 0;
    const isNew = isNewUser || !hasHistory;

    // Smart Anti-Spam Check: If the very last message in history was already a system auto-reply, don't spam duplicate
    if (hasHistory) {
      const lastMsg = historyMessages[historyMessages.length - 1];
      if (lastMsg && (lastMsg.fromNickname === '系统客服' || (lastMsg.id && String(lastMsg.id).startsWith('auto-')))) {
        Logger.debug('AUTO_REPLY_SKIPPED', `ClientID ${clientId} already has recent auto-reply as last message`);
        return null;
      }
    }

    let replyText = '';
    const mode = config.mode || 'first_and_followup';

    if (mode === 'first_only') {
      if (!isNew) {
        Logger.debug('AUTO_REPLY_SKIPPED', `ClientID ${clientId} is not a new user (first_only mode)`);
        return null;
      }
      replyText = config.firstMessage || config.message;
    } else if (mode === 'always_same') {
      replyText = config.firstMessage || config.message;
    } else if (mode === 'first_and_followup') {
      if (isNew) {
        replyText = config.firstMessage || config.message;
      } else {
        replyText = config.followupMessage || '您好，欢迎再次回来！客服目前暂时不在电脑前，已为您记录留言，请耐心等待回复！';
      }
    }

    if (!replyText || typeof replyText !== 'string' || replyText.trim() === '') {
      return null;
    }

    // Construct auto-reply message payload
    const now = new Date().toISOString();
    const autoReplyMsg = {
      id: 'auto-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7),
      clientId: clientId,
      senderRole: 'admin',
      fromNickname: '系统客服',
      text: replyText.trim(),
      timestamp: now,
      targetAdmin: null
    };

    // Save auto-reply message into database
    try {
      ChatDatabase.saveMessage(clientId, autoReplyMsg);
      Logger.info('AUTO_REPLY_SENT', `Triggered offline auto-reply (${mode}) to ClientID: ${clientId}`);
      return autoReplyMsg;
    } catch (err) {
      Logger.error('AUTO_REPLY_ERROR', `Failed to save auto-reply message for ClientID: ${clientId}`, err);
      return null;
    }
  }
}

module.exports = AutoReplyService;
