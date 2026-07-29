/**
 * Main Application Logic for MyChat (Client & Admin) - ES Module Orchestrator
 * Modularized architecture delegating to user-chat, admin-customer, and admin-team modules.
 */
import { API_BASE } from './core/config.js';
import { requestNotificationPermission, sendDesktopNotification, playNotificationSound } from './core/notif.js';
import { UserChatModule } from './modules/user-chat.js';
import { AdminCustomerModule } from './modules/admin-customer.js';
import { AdminTeamModule } from './modules/admin-team.js';

document.addEventListener('DOMContentLoaded', () => {
  const socket = io({
    path: API_BASE ? `${API_BASE}/socket.io` : '/socket.io'
  });

  const myDeviceId = window.DeviceFingerprint.getDeviceId();

  // State
  let currentRole = null; // 'user' | 'admin'
  let userProfile = null; // { nickname, reason, deviceId }
  let currentAdminUsername = null;
  let currentAdminRole = null;
  let keySequence = '';
  let adminActiveSidebarTab = 'customers'; // 'customers' | 'team'

  // Modules
  const userChat = new UserChatModule(socket, myDeviceId);
  const adminCustomer = new AdminCustomerModule(socket);
  const adminTeam = new AdminTeamModule(socket);

  window.userChat = userChat;
  window.adminCustomer = adminCustomer;
  window.adminTeam = adminTeam;
  window.adminActiveSidebarTab = 'customers';

  // DOM Elements - Modal & Forms
  const modalOverlay = document.getElementById('login-modal');
  const tabUserRole = document.getElementById('tab-user-role');
  const tabAdminRole = document.getElementById('tab-admin-role');
  const userLoginForm = document.getElementById('user-login-form');
  const adminLoginForm = document.getElementById('admin-login-form');
  const inputNickname = document.getElementById('input-nickname');
  const inputReason = document.getElementById('input-reason');
  const inputAdminUsername = document.getElementById('input-admin-username');
  const inputAdminPassword = document.getElementById('input-admin-password');
  const loginError = document.getElementById('login-error');
  const errorText = document.getElementById('error-text');

  // DOM Elements - Views & Buttons
  const userView = document.getElementById('user-view');
  const adminView = document.getElementById('admin-view');
  const btnUserLogout = document.getElementById('btn-user-logout');
  const btnAdminLogout = document.getElementById('btn-admin-logout');

  // DOM Elements - Admin Sidebar Tabs
  const adminTabCustomers = document.getElementById('admin-tab-customers');
  const adminTabTeam = document.getElementById('admin-tab-team');
  const customersUnreadBadge = document.getElementById('customers-unread-badge');
  const teamUnreadBadge = document.getElementById('team-unread-badge');
  const adminUserList = document.getElementById('admin-user-list');
  const adminTeamList = document.getElementById('admin-team-list');
  const adminUserSearch = document.getElementById('admin-user-search');

  // Lightbox Modal
  const lightboxModal = document.getElementById('image-lightbox-modal');
  const lightboxImage = document.getElementById('lightbox-image-element');
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');

  if (btnCloseLightbox && lightboxModal) {
    btnCloseLightbox.addEventListener('click', () => {
      lightboxModal.classList.add('hidden');
    });
    lightboxModal.addEventListener('click', (e) => {
      if (e.target === lightboxModal) {
        lightboxModal.classList.add('hidden');
      }
    });
  }

  // =========================================================================
  // Automatic Reconnection & Page Unload Listeners
  // =========================================================================
  socket.on('connect', () => {
    console.log('[SOCKET CONNECTED] ID:', socket.id);
    if (currentRole === 'user' && userProfile) {
      socket.emit('join-user', { 
        nickname: userProfile.nickname, 
        reason: userProfile.reason, 
        clientId: myDeviceId 
      }, (res) => {
        if (res) {
          userChat.updateAdminStatusUI(res);
          if (res.historyMessages) {
            syncUserOfflineMessages(res.historyMessages);
          }
        }
      });
    } else if (currentRole === 'admin') {
      const existingProfile = window.ChatStorageManager.getProfile();
      const token = existingProfile ? existingProfile.adminToken : null;
      socket.emit('join-admin', { token, username: currentAdminUsername }, (res) => {
        if (res && res.success) {
          currentAdminUsername = res.username;
          currentAdminRole = res.role;
          adminCustomer.currentAdminUsername = res.username;
          adminCustomer.currentAdminRole = res.role;
          adminTeam.initTeamView(res.username, res.role);

          if (res.allMessages) {
            syncAdminOfflineMessages(res.allMessages);
          }
          if (res.internalMessages) {
            adminTeam.allAdminInternalMessages = res.internalMessages;
          }
          if (res.adminList) {
            userChat.updateAdminStatusUI(res);
            adminTeam.setAvailableAdmins(res.adminList);
          }
          if (res.users) {
            adminCustomer.updateAdminUsersMap(res.users);
            adminCustomer.renderUserList();
          }
        }
      });
    }
  });

  socket.on('admin-force-logout', ({ message }) => {
    alert(message || '您的管理员账号已被主管理注销/断开连接');
    window.ChatStorageManager.clearProfile();
    location.reload();
  });

  window.addEventListener('beforeunload', () => {
    if (currentRole === 'user') {
      socket.emit('leave-user');
    }
  });

  // =========================================================================
  // Secret Trigger Code Listener for Admin Login (Keyboard secret key & Mobile 5-tap gesture)
  // =========================================================================
  const loginHeader = document.querySelector('.login-header');
  let tapCount = 0;
  let lastTapTime = 0;

  if (loginHeader) {
    loginHeader.addEventListener('click', () => {
      const now = Date.now();
      if (now - lastTapTime < 500) {
        tapCount++;
      } else {
        tapCount = 1;
      }
      lastTapTime = now;

      if (tapCount >= 5) {
        tapCount = 0;
        revealAdminLogin();
      }
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.key && e.key.length === 1) {
      keySequence += e.key;
      if (keySequence.length > 30) {
        keySequence = keySequence.slice(-30);
      }

      socket.emit('verify-admin-trigger', { code: keySequence }, (res) => {
        if (res && res.success) {
          revealAdminLogin();
        }
      });
    }
  });

  function revealAdminLogin() {
    tabAdminRole.style.display = 'inline-flex';
    tabUserRole.style.width = 'auto';
    tabAdminRole.click();
    showError('🎉 管理员暗号已触发！请输入管理员账号与密码登录');
    if (inputAdminUsername && !inputAdminUsername.value) {
      inputAdminUsername.focus();
    } else if (inputAdminPassword) {
      inputAdminPassword.focus();
    }
    keySequence = '';
  }

  // Initial Local Storage Check
  const lastUserInfo = window.ChatStorageManager.getLastUserInfo();
  if (lastUserInfo) {
    if (lastUserInfo.nickname && inputNickname) inputNickname.value = lastUserInfo.nickname;
    if (lastUserInfo.reason && inputReason) inputReason.value = lastUserInfo.reason;
  }

  const savedProfile = window.ChatStorageManager.getProfile();
  if (savedProfile) {
    if (savedProfile.role === 'user' && savedProfile.nickname && savedProfile.reason) {
      inputNickname.value = savedProfile.nickname;
      inputReason.value = savedProfile.reason;
      currentRole = 'user';
      userProfile = savedProfile;
      socket.emit('join-user', { 
        nickname: savedProfile.nickname, 
        reason: savedProfile.reason, 
        clientId: myDeviceId 
      }, (joinRes) => {
        if (joinRes && joinRes.success) {
          userChat.updateAdminStatusUI(joinRes);
          if (joinRes.historyMessages) syncUserOfflineMessages(joinRes.historyMessages);
          initUserView();
        }
      });
    } else if (savedProfile.role === 'admin' && (savedProfile.adminToken || savedProfile.adminKey)) {
      currentRole = 'admin';
      currentAdminUsername = savedProfile.adminUsername || 'admin';
      currentAdminRole = savedProfile.adminRole || 'super_admin';
      if (inputAdminUsername) inputAdminUsername.value = currentAdminUsername;
      revealAdminLogin();
      socket.emit('join-admin', {
        token: savedProfile.adminToken,
        secretKey: savedProfile.adminKey,
        username: currentAdminUsername
      }, (res) => {
        if (res && res.success) {
          currentAdminUsername = res.username;
          currentAdminRole = res.role;
          adminCustomer.currentAdminUsername = res.username;
          adminCustomer.currentAdminRole = res.role;
          adminTeam.initTeamView(res.username, res.role);

          window.ChatStorageManager.saveProfile({
            role: 'admin',
            adminUsername: res.username,
            adminRole: res.role,
            adminToken: res.token
          });
          if (res.allMessages) syncAdminOfflineMessages(res.allMessages);
          if (res.internalMessages) adminTeam.allAdminInternalMessages = res.internalMessages;
          if (res.adminList) {
            userChat.updateAdminStatusUI(res);
            adminTeam.setAvailableAdmins(res.adminList);
          }
          initAdminView(res.users || []);
        } else {
          showError((res && res.message) || '管理员身份凭证已失效，请重新输入密码登录');
        }
      });
    }
  }

  function showError(msg) {
    errorText.textContent = msg;
    loginError.classList.remove('hidden');
  }
  function hideError() {
    loginError.classList.add('hidden');
  }

  // Role Switch Tabs
  tabUserRole.addEventListener('click', () => {
    tabUserRole.classList.add('active');
    tabAdminRole.classList.remove('active');
    userLoginForm.style.display = 'block';
    adminLoginForm.style.display = 'none';
    hideError();
  });

  tabAdminRole.addEventListener('click', () => {
    tabAdminRole.classList.add('active');
    tabUserRole.classList.remove('active');
    adminLoginForm.style.display = 'block';
    userLoginForm.style.display = 'none';
    hideError();
  });

  function syncUserOfflineMessages(historyMessages) {
    if (!Array.isArray(historyMessages)) return;
    if (historyMessages.length === 0) {
      const key = window.ChatStorageManager.getChatKey(myDeviceId, 'user');
      const existingLocal = window.ChatStorageManager.getMessages(myDeviceId, 'user');
      if (existingLocal.length > 0) {
        localStorage.removeItem(key);
        if (currentRole === 'user') userChat.renderMessages();
      }
      return;
    }
    const existingLocal = window.ChatStorageManager.getMessages(myDeviceId, 'user');
    const localMap = new Map(existingLocal.map(m => [m.id, m]));
    historyMessages.forEach(srvMsg => {
      localMap.set(srvMsg.id, srvMsg);
    });
    const merged = Array.from(localMap.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const key = window.ChatStorageManager.getChatKey(myDeviceId, 'user');
    localStorage.setItem(key, JSON.stringify(merged));

    if (currentRole === 'user') {
      userChat.renderMessages();
    }
  }

  function syncAdminOfflineMessages(allMessages) {
    if (!allMessages || typeof allMessages !== 'object') return;
    Object.keys(allMessages).forEach(cId => {
      const srvMsgs = allMessages[cId];
      if (Array.isArray(srvMsgs) && srvMsgs.length > 0) {
        const existingLocal = window.ChatStorageManager.getMessages(cId, 'admin');
        const localMap = new Map(existingLocal.map(m => [m.id, m]));
        let newCount = 0;
        srvMsgs.forEach(m => {
          if (!localMap.has(m.id)) {
            if (m.senderRole === 'user') {
              newCount++;
            }
          }
          localMap.set(m.id, m);
        });
        const merged = Array.from(localMap.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const key = window.ChatStorageManager.getChatKey(cId, 'admin');
        localStorage.setItem(key, JSON.stringify(merged));

        if (newCount > 0 && cId !== adminCustomer.adminSelectedClientId) {
          for (let i = 0; i < newCount; i++) {
            window.ChatStorageManager.incrementUnreadCount(cId);
          }
        }
      }
    });

    if (currentRole === 'admin') {
      adminCustomer.renderUserList();
      if (adminCustomer.adminSelectedClientId) {
        adminCustomer.renderChat();
      }
    }
  }

  // User Login Submit
  userLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    hideError();

    const nickname = inputNickname.value.trim();
    const reason = inputReason.value.trim();

    if (!nickname || !reason) {
      return showError('昵称与请求原因均不能为空');
    }

    requestNotificationPermission();

    socket.emit('check-nickname', { nickname, clientId: myDeviceId }, (res) => {
      if (!res.available) {
        return showError(res.message || '昵称已被在线用户使用，请换一个');
      }

      socket.emit('join-user', { nickname, reason, clientId: myDeviceId }, (joinRes) => {
        if (!joinRes.success) {
          return showError(joinRes.message || '进入聊天失败');
        }

        currentRole = 'user';
        userProfile = { nickname, reason, deviceId: myDeviceId };
        window.ChatStorageManager.saveProfile({ role: 'user', nickname, reason, deviceId: myDeviceId });

        userChat.updateAdminStatusUI(joinRes);
        if (joinRes.historyMessages) {
          syncUserOfflineMessages(joinRes.historyMessages);
        }

        initUserView();
      });
    });
  });

  // Admin Login Submit
  adminLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    hideError();

    const username = inputAdminUsername ? inputAdminUsername.value.trim() : '';
    const password = inputAdminPassword ? inputAdminPassword.value.trim() : '';
    if (!username || !password) {
      return showError('请输入管理员账号与密码');
    }

    if (!socket || !socket.connected) {
      return showError('与服务器的网络连接已断开，正在尝试重连，请稍后再试...');
    }

    requestNotificationPermission();

    const btnSubmit = adminLoginForm.querySelector('.btn-submit');
    const originalText = btnSubmit ? btnSubmit.innerHTML : '';
    if (btnSubmit) {
      btnSubmit.disabled = true;
      btnSubmit.innerHTML = '<span>登录验证中...</span> ⏳';
    }

    let isResponded = false;
    const timeoutTimer = setTimeout(() => {
      if (!isResponded) {
        isResponded = true;
        if (btnSubmit) {
          btnSubmit.disabled = false;
          btnSubmit.innerHTML = originalText;
        }
        showError('登录响应超时，请检查密码或网络状态后重试');
      }
    }, 4000);

    socket.emit('join-admin', { username, password }, (res) => {
      if (isResponded) return;
      isResponded = true;
      clearTimeout(timeoutTimer);

      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalText;
      }

      if (!res || !res.success) {
        return showError((res && res.message) || '管理员账号或密码错误');
      }

      currentRole = 'admin';
      currentAdminUsername = res.username;
      currentAdminRole = res.role;
      adminCustomer.currentAdminUsername = res.username;
      adminCustomer.currentAdminRole = res.role;
      adminTeam.initTeamView(res.username, res.role);

      window.ChatStorageManager.saveProfile({
        role: 'admin',
        adminUsername: res.username,
        adminRole: res.role,
        adminToken: res.token
      });

      if (res.allMessages) syncAdminOfflineMessages(res.allMessages);
      if (res.internalMessages) adminTeam.allAdminInternalMessages = res.internalMessages;
      if (res.adminList) {
        userChat.updateAdminStatusUI(res);
        adminTeam.setAvailableAdmins(res.adminList);
      }

      initAdminView(res.users || []);
    });
  });

  btnUserLogout.addEventListener('click', () => {
    if (currentRole === 'user') {
      if (userProfile && (userProfile.nickname || userProfile.reason)) {
        window.ChatStorageManager.saveLastUserInfo(userProfile.nickname, userProfile.reason);
      }
      socket.emit('leave-user');
    }
    window.ChatStorageManager.clearProfile();
    location.reload();
  });
  
  btnAdminLogout.addEventListener('click', () => {
    window.ChatStorageManager.clearProfile();
    location.reload();
  });

  function initUserView() {
    modalOverlay.classList.add('hidden');
    userView.classList.remove('hidden');
    adminView.classList.add('hidden');
    userChat.initView(userProfile);
  }

  function initAdminView(serverUsers) {
    modalOverlay.classList.add('hidden');
    adminView.classList.remove('hidden');
    userView.classList.add('hidden');

    adminCustomer.updateAdminUsersMap(serverUsers);
    adminCustomer.renderUserList();

    if (adminTabCustomers) {
      adminTabCustomers.addEventListener('click', () => {
        adminActiveSidebarTab = 'customers';
        window.adminActiveSidebarTab = 'customers';
        adminTabCustomers.classList.add('active');
        if (adminTabTeam) adminTabTeam.classList.remove('active');
        if (adminUserList) adminUserList.classList.remove('hidden');
        if (adminTeamList) adminTeamList.classList.add('hidden');
        if (adminUserSearch) adminUserSearch.placeholder = '搜索用户昵称/ID/原因...';
        adminCustomer.customersUnreadCount = 0;
        if (customersUnreadBadge) customersUnreadBadge.classList.add('hidden');
        if (adminCustomer.adminSelectedClientId) {
          adminCustomer.selectUserForAdmin(adminCustomer.adminSelectedClientId);
        }
      });
    }

    if (adminTabTeam) {
      adminTabTeam.addEventListener('click', () => {
        adminActiveSidebarTab = 'team';
        window.adminActiveSidebarTab = 'team';
        adminTabTeam.classList.add('active');
        if (adminTabCustomers) adminTabCustomers.classList.remove('active');
        if (adminTeamList) adminTeamList.classList.remove('hidden');
        if (adminUserList) adminUserList.classList.add('hidden');
        if (adminUserSearch) adminUserSearch.placeholder = '搜索团队成员...';
        adminTeam.teamUnreadCount = 0;
        if (teamUnreadBadge) teamUnreadBadge.classList.add('hidden');

        adminTeam.fetchAdminList();
        adminTeam.renderTeamList();
        adminTeam.selectAdminInternalTarget(adminTeam.adminInternalTarget);
      });
    }

    if (!adminCustomer.adminSelectedClientId && adminCustomer.allAdminUsersMap.size > 0) {
      const usersList = Array.from(adminCustomer.allAdminUsersMap.values());
      usersList.sort((a, b) => {
        const unreadA = window.ChatStorageManager.getUnreadCount(a.clientId);
        const unreadB = window.ChatStorageManager.getUnreadCount(b.clientId);
        if (unreadB !== unreadA) return unreadB - unreadA;
        return (b.online ? 1 : 0) - (a.online ? 1 : 0);
      });
      if (usersList.length > 0) {
        adminCustomer.selectUserForAdmin(usersList[0].clientId);
      }
    }
  }

  // Socket Events Delegation
  socket.on('admin-status-change', (data) => {
    userChat.updateAdminStatusUI(data);
    if (data && data.adminList) {
      adminTeam.setAvailableAdmins(data.adminList);
    }
    if (currentRole === 'admin' && adminActiveSidebarTab === 'team') {
      adminTeam.renderTeamList();
    }
  });

  socket.on('new-admin-message', (msgObj) => {
    if (currentRole === 'user') {
      window.ChatStorageManager.saveMessage(myDeviceId, msgObj, 'user');
      userChat.renderMessages();

      const notifBody = msgObj.text.startsWith('data:image/') ? '[图片消息]' : msgObj.text;
      sendDesktopNotification('💬 来自管理员的新消息', {
        body: notifBody,
        tag: 'admin-reply'
      });
    }
  });

  socket.on('admin-typing', ({ isTyping }) => {
    if (currentRole === 'user' && userChat.userTypingStatus) {
      userChat.userTypingStatus.style.display = isTyping ? 'block' : 'none';
    }
  });

  socket.on('session-deleted-by-admin', () => {
    if (currentRole === 'user') {
      window.ChatStorageManager.clearMessages(myDeviceId, 'user');
      userChat.renderMessages();
      sendDesktopNotification('⚠️ 会话已重置', {
        body: '管理员已彻底清空/双向删除该会话记录',
        tag: 'session-deleted'
      });
    }
  });

  socket.on('session-cleared-by-admin', () => {
    if (currentRole === 'user') {
      window.ChatStorageManager.clearMessages(myDeviceId, 'user');
      userChat.renderMessages();
    }
  });

  socket.on('new-admin-internal-message', (msgObj) => {
    if (currentRole !== 'admin') return;
    adminTeam.onNewInternalMessage(msgObj, adminActiveSidebarTab === 'team');
  });

  socket.on('admin-message-sent', (msgObj) => {
    if (currentRole === 'admin') {
      const clientId = msgObj.targetClientId;
      window.ChatStorageManager.saveMessage(clientId, msgObj, 'admin');

      if (adminCustomer.adminSelectedClientId === clientId) {
        adminCustomer.renderChat();
      }
      adminCustomer.renderUserList();
    }
  });

  socket.on('file-request-response', async ({ msgId, targetClientId, approved }) => {
    const chatRole = currentRole === 'admin' ? 'admin' : 'user';
    const chatId = currentRole === 'admin' ? targetClientId : myDeviceId;

    const messages = window.ChatStorageManager.getMessages(chatId, chatRole);
    const targetMsg = messages.find(m => m.id === msgId);
    if (targetMsg) {
      let parsed = userChat.parseFileMsg(targetMsg) || {};
      parsed.fileStatus = approved ? 'approved' : 'rejected';
      targetMsg.text = JSON.stringify(parsed);
      targetMsg.fileData = parsed;

      const key = window.ChatStorageManager.getChatKey(chatId, chatRole);
      localStorage.setItem(key, JSON.stringify(messages));
    }

    if (currentRole === 'user') {
      userChat.renderMessages();
      if (approved && userChat.pendingFilesMap.has(msgId)) {
        const file = userChat.pendingFilesMap.get(msgId);
        try {
          await adminCustomer.uploadFileToServer(file, msgId, myDeviceId);
          userChat.pendingFilesMap.delete(msgId);
        } catch (err) {
          alert('上传文件失败: ' + err.message);
        }
      }
    } else if (currentRole === 'admin' && adminCustomer.adminSelectedClientId === targetClientId) {
      adminCustomer.renderChat();
    }
  });

  socket.on('file-upload-finished', ({ msgId, targetClientId, fileUrl, fileData }) => {
    const chatRole = currentRole === 'admin' ? 'admin' : 'user';
    const chatId = currentRole === 'admin' ? targetClientId : myDeviceId;

    const messages = window.ChatStorageManager.getMessages(chatId, chatRole);
    const targetMsg = messages.find(m => m.id === msgId);
    if (targetMsg) {
      let parsed = userChat.parseFileMsg(targetMsg) || {};
      parsed.fileStatus = 'completed';
      parsed.fileUrl = fileUrl;
      targetMsg.text = JSON.stringify(parsed);
      targetMsg.fileData = parsed;

      const key = window.ChatStorageManager.getChatKey(chatId, chatRole);
      localStorage.setItem(key, JSON.stringify(messages));
    }

    if (currentRole === 'user') {
      userChat.renderMessages();
    } else if (currentRole === 'admin' && adminCustomer.adminSelectedClientId === targetClientId) {
      adminCustomer.renderChat();
    }
  });

  socket.on('update-user-list', (userList) => {
    if (currentRole === 'admin') {
      adminCustomer.updateAdminUsersMap(userList);
      adminCustomer.renderUserList();

      if (adminCustomer.adminSelectedClientId) {
        const u = adminCustomer.allAdminUsersMap.get(adminCustomer.adminSelectedClientId);
        if (u) {
          adminCustomer.adminTargetNickname.innerHTML = `${adminCustomer.escapeHTML(u.nickname)} <span style="font-size:11px; font-weight:normal; color:var(--text-dim);">(${adminCustomer.escapeHTML(u.clientId)})</span>`;
          adminCustomer.adminTargetStatus.innerHTML = u.online 
            ? `<span class="status-dot online"></span> 状态：在线`
            : `<span class="status-dot"></span> 状态：离线 ${u.lastSeen ? '(上次在线: ' + adminCustomer.formatTime(u.lastSeen) + ')' : ''}`;

          const nicks = (u.nicknameHistory || []).map(n => adminCustomer.escapeHTML(n.nickname));
          const ips = (u.ipHistory || []).map(i => `${adminCustomer.escapeHTML(i.ip_address)} (${adminCustomer.formatTime(i.logged_in_at)})`);

          adminCustomer.historyNicknamesText.innerHTML = nicks.length > 0 ? nicks.join(' <span style="color:var(--text-dim);">➔</span> ') : adminCustomer.escapeHTML(u.nickname);
          adminCustomer.historyIpsText.innerHTML = ips.length > 0 ? ips.join(' | ') : adminCustomer.escapeHTML(u.lastIp || '127.0.0.1');
        }
      }
    }
  });

  socket.on('new-user-message', (msgObj) => {
    if (currentRole === 'admin') {
      const clientId = msgObj.clientId;

      if (adminCustomer.allAdminUsersMap.has(clientId)) {
        const u = adminCustomer.allAdminUsersMap.get(clientId);
        u.nickname = msgObj.fromNickname || u.nickname;
        u.reason = msgObj.reason || u.reason;
        u.online = true;
      } else {
        adminCustomer.allAdminUsersMap.set(clientId, {
          clientId: clientId,
          nickname: msgObj.fromNickname,
          reason: msgObj.reason,
          online: true
        });
      }

      window.ChatStorageManager.saveMessage(clientId, msgObj, 'admin');

      if (adminActiveSidebarTab === 'customers' && adminCustomer.adminSelectedClientId === clientId) {
        adminCustomer.renderChat();
      } else {
        window.ChatStorageManager.incrementUnreadCount(clientId);
        if (adminActiveSidebarTab !== 'customers') {
          adminCustomer.customersUnreadCount++;
          if (customersUnreadBadge) {
            customersUnreadBadge.textContent = adminCustomer.customersUnreadCount;
            customersUnreadBadge.classList.remove('hidden');
          }
        }
      }

      adminCustomer.renderUserList();

      const fileData = userChat.parseFileMsg(msgObj);
      let notifBody = '';
      if (fileData) {
        notifBody = `求助原因: ${msgObj.reason || '无'}\n[请求传输文件: ${fileData.fileName}]`;
      } else if (msgObj.text && typeof msgObj.text === 'string' && msgObj.text.startsWith('data:image/')) {
        notifBody = `求助原因: ${msgObj.reason || '无'}\n[发送了一张图片]`;
      } else {
        notifBody = `求助原因: ${msgObj.reason || '无'}\n消息: ${msgObj.text}`;
      }

      sendDesktopNotification(`💬 来自 ${msgObj.fromNickname} 的新消息`, {
        body: notifBody,
        tag: `user-msg-${clientId}`
      }, () => {
        adminCustomer.selectUserForAdmin(clientId);
      });
    }
  });

  socket.on('user-typing', ({ clientId, nickname, isTyping }) => {
    if (currentRole === 'admin' && adminActiveSidebarTab === 'customers' && adminCustomer.adminSelectedClientId === clientId) {
      if (adminCustomer.adminTypingStatus) {
        adminCustomer.adminTypingStatus.style.display = isTyping ? 'block' : 'none';
      }
    }
  });
});
