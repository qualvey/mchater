/**
 * DeviceFingerprint & ChatStorageManager
 * Handles device fingerprint generation & LocalStorage chat persistence
 */

class DeviceFingerprint {
  static getDeviceId() {
    let deviceId = localStorage.getItem('mychat_device_id');
    if (!deviceId) {
      let fpString = '';
      try {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('MyChatDeviceFP_2026', 2, 2);
        fpString += canvas.toDataURL();
      } catch (e) {}

      fpString += '||' + (navigator.userAgent || '');
      fpString += '||' + (screen.width + 'x' + screen.height + 'x' + screen.colorDepth);
      fpString += '||' + (new Date().getTimezoneOffset());
      fpString += '||' + (navigator.language || '');

      let hash = 0;
      for (let i = 0; i < fpString.length; i++) {
        const char = fpString.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash |= 0;
      }

      const hashStr = Math.abs(hash).toString(36);
      const randStr = Math.random().toString(36).substring(2, 8);
      deviceId = `dev_${hashStr}_${randStr}`;
      localStorage.setItem('mychat_device_id', deviceId);
    }
    return deviceId;
  }
}

class ChatStorageManager {
  static PROFILE_KEY = 'mychat_user_profile';

  // Save logged-in profile (binds deviceId, nickname, reason)
  static saveProfile(profile) {
    try {
      const deviceId = DeviceFingerprint.getDeviceId();
      const payload = { ...profile, deviceId };
      localStorage.setItem(this.PROFILE_KEY, JSON.stringify(payload));
    } catch (e) {
      console.error('Failed to save profile to localStorage', e);
    }
  }

  // Get saved profile
  static getProfile() {
    try {
      const data = localStorage.getItem(this.PROFILE_KEY);
      if (!data) return null;
      const profile = JSON.parse(data);
      profile.deviceId = DeviceFingerprint.getDeviceId();
      return profile;
    } catch (e) {
      console.error('Failed to get profile from localStorage', e);
      return null;
    }
  }

  // Clear profile
  static clearProfile() {
    localStorage.removeItem(this.PROFILE_KEY);
  }

  // Generate storage key for a user's conversation (Keyed by deviceId / clientId)
  static getChatKey(identifier, role = 'user') {
    const cleanId = String(identifier || '').trim().toLowerCase();
    return role === 'admin' 
      ? `mychat_history_admin_${cleanId}` 
      : `mychat_history_user_${cleanId}`;
  }

  // Get all messages for a specific conversation
  static getMessages(identifier, role = 'user') {
    try {
      const key = this.getChatKey(identifier, role);
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error(`Failed to load messages for ${identifier}`, e);
      return [];
    }
  }

  // Save single message to conversation
  static saveMessage(identifier, message, role = 'user') {
    try {
      const messages = this.getMessages(identifier, role);
      if (message.id && messages.some(m => m.id === message.id)) {
        return messages;
      }
      messages.push(message);
      const key = this.getChatKey(identifier, role);
      localStorage.setItem(key, JSON.stringify(messages));
      return messages;
    } catch (e) {
      console.error(`Failed to save message for ${identifier}`, e);
      return [];
    }
  }

  // Clear conversation history
  static clearMessages(identifier, role = 'user') {
    try {
      const key = this.getChatKey(identifier, role);
      localStorage.removeItem(key);
      const unreadKey = `mychat_unread_${String(identifier).trim().toLowerCase()}`;
      localStorage.removeItem(unreadKey);
    } catch (e) {
      console.error(`Failed to clear messages for ${identifier}`, e);
    }
  }

  // Manage unread message counts for Admin
  static getUnreadCount(identifier) {
    try {
      const key = `mychat_unread_${String(identifier).trim().toLowerCase()}`;
      return parseInt(localStorage.getItem(key) || '0', 10);
    } catch (e) {
      return 0;
    }
  }

  static incrementUnreadCount(identifier) {
    try {
      const key = `mychat_unread_${String(identifier).trim().toLowerCase()}`;
      const current = this.getUnreadCount(identifier);
      localStorage.setItem(key, (current + 1).toString());
      return current + 1;
    } catch (e) {
      return 0;
    }
  }

  static clearUnreadCount(identifier) {
    try {
      const key = `mychat_unread_${String(identifier).trim().toLowerCase()}`;
      localStorage.setItem(key, '0');
    } catch (e) {
      console.error('Failed to clear unread count', e);
    }
  }
}

window.DeviceFingerprint = DeviceFingerprint;
window.ChatStorageManager = ChatStorageManager;
