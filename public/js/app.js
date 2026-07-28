/**
 * Main Application Logic for MyChat (Client & Admin)
 * Anchored by Device Fingerprint ID & SQLite Persistence
 * Includes Image Sending (Paste, Drag & Drop, File Upload, Lightbox Preview)
 */
document.addEventListener('DOMContentLoaded', () => {
  // Dynamic Base Path & Host Helper (Supports Subpath / Proxy Deployment)
  const getRawBase = () => {
    if (typeof window.MYCHAT_BASE_PATH !== 'undefined') return window.MYCHAT_BASE_PATH;
    const path = window.location.pathname;
    return path.replace(/\/index\.html$/, '').replace(/\/$/, '');
  };
  const API_BASE = getRawBase().replace(/\/$/, '');
  const formatApiUrl = (endpoint) => {
    if (!endpoint) return '';
    if (endpoint.startsWith('http://') || endpoint.startsWith('https://') || endpoint.startsWith('data:')) return endpoint;
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
    return `${API_BASE}${cleanEndpoint}`;
  };

  const socket = io({
    path: API_BASE ? `${API_BASE}/socket.io` : '/socket.io'
  });

  // Device Fingerprint ID for this browser
  const myDeviceId = DeviceFingerprint.getDeviceId();

  // State
  let currentRole = null; // 'user' | 'admin'
  let userProfile = null; // { nickname, reason, deviceId }
  let adminSelectedClientId = null; // Admin selected clientId
  let allAdminUsersMap = new Map(); // clientId -> { clientId, nickname, reason, online, lastSeen, nicknameHistory, ipHistory }
  let typingTimer = null;
  let keySequence = '';
  let currentAdminKey = '';

  // DOM Elements - Modal & Forms
  const modalOverlay = document.getElementById('login-modal');
  const tabUserRole = document.getElementById('tab-user-role');
  const tabAdminRole = document.getElementById('tab-admin-role');
  const userLoginForm = document.getElementById('user-login-form');
  const adminLoginForm = document.getElementById('admin-login-form');
  const inputNickname = document.getElementById('input-nickname');
  const inputReason = document.getElementById('input-reason');
  const inputAdminKey = document.getElementById('input-admin-key');
  const loginError = document.getElementById('login-error');
  const errorText = document.getElementById('error-text');

  // DOM Elements - User View
  const userView = document.getElementById('user-view');
  const userChatMain = document.getElementById('user-chat-main');
  const userDragOverlay = document.getElementById('user-drag-overlay');
  const userIdentityTag = document.getElementById('user-identity-tag');
  const userReasonDisplay = document.getElementById('user-reason-display');
  const userMessagesContainer = document.getElementById('user-messages');
  const userInput = document.getElementById('user-input');
  const userInputArea = document.getElementById('user-input-area');
  const btnUserImage = document.getElementById('btn-user-image');
  const userImageInput = document.getElementById('user-image-input');
  const btnUserFile = document.getElementById('btn-user-file');
  const userAnyfileInput = document.getElementById('user-anyfile-input');
  const btnUserSend = document.getElementById('btn-user-send');
  const btnUserLogout = document.getElementById('btn-user-logout');
  const adminStatusDot = document.getElementById('admin-status-dot');
  const adminStatusText = document.getElementById('admin-status-text');
  const userTypingStatus = document.getElementById('user-typing-status');

  // DOM Elements - Admin View
  const adminView = document.getElementById('admin-view');
  const adminChatMain = document.getElementById('admin-chat-main');
  const adminDragOverlay = document.getElementById('admin-drag-overlay');
  const adminDragIcon = document.getElementById('admin-drag-icon');
  const adminDragTitle = document.getElementById('admin-drag-title');
  const adminDragDesc = document.getElementById('admin-drag-desc');
  const adminUserListContainer = document.getElementById('admin-user-list');
  const adminUserSearch = document.getElementById('admin-user-search');
  const adminMessagesContainer = document.getElementById('admin-messages');
  const adminInput = document.getElementById('admin-input');
  const adminInputArea = document.getElementById('admin-input-area');
  const btnAdminImage = document.getElementById('btn-admin-image');
  const adminImageInput = document.getElementById('admin-image-input');
  const btnAdminFile = document.getElementById('btn-admin-file');
  const adminAnyfileInput = document.getElementById('admin-anyfile-input');
  const btnAdminSend = document.getElementById('btn-admin-send');
  const btnAdminLogout = document.getElementById('btn-admin-logout');
  const btnClearTargetChat = document.getElementById('btn-clear-target-chat');
  const adminTargetAvatar = document.getElementById('admin-target-avatar');
  const adminTargetNickname = document.getElementById('admin-target-nickname');
  const adminTargetStatus = document.getElementById('admin-target-status');
  const adminTargetReasonBar = document.getElementById('admin-target-reason-bar');
  const adminTargetReasonText = document.getElementById('admin-target-reason-text');
  const adminTypingStatus = document.getElementById('admin-typing-status');
  const btnToggleUserHistory = document.getElementById('btn-toggle-user-history');
  const adminUserHistoryPanel = document.getElementById('admin-user-history-panel');
  const historyNicknamesText = document.getElementById('history-nicknames-text');
  const historyIpsText = document.getElementById('history-ips-text');
  const btnMobileBackUsers = document.getElementById('btn-mobile-back-users');

  // DOM Elements - Context Menu
  const adminContextMenu = document.getElementById('admin-context-menu');
  const ctxItemClear = document.getElementById('ctx-item-clear');
  const ctxItemDelete = document.getElementById('ctx-item-delete');
  let activeContextClientId = null;

  // DOM Elements - Lightbox Modal
  const lightboxModal = document.getElementById('image-lightbox-modal');
  const lightboxImage = document.getElementById('lightbox-image-element');
  const btnCloseLightbox = document.getElementById('btn-close-lightbox');

  // Audit history drawer toggle
  if (btnToggleUserHistory && adminUserHistoryPanel) {
    btnToggleUserHistory.addEventListener('click', () => {
      const isHidden = adminUserHistoryPanel.style.display === 'none' || !adminUserHistoryPanel.style.display;
      adminUserHistoryPanel.style.display = isHidden ? 'block' : 'none';
    });
  }

  // Mobile Back Button to User List Sidebar
  if (btnMobileBackUsers && adminView) {
    btnMobileBackUsers.addEventListener('click', () => {
      adminView.classList.remove('mobile-show-chat');
    });
  }

  // Lightbox Handlers
  function openImageLightbox(src) {
    if (lightboxImage && lightboxModal) {
      lightboxImage.src = src;
      lightboxModal.classList.remove('hidden');
    }
  }

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
  // Client Image Helper (Compression & Canvas Reader)
  // =========================================================================
  function compressAndReadImage(file, maxWidth = 1200, quality = 0.75) {
    return new Promise((resolve, reject) => {
      if (!file || !file.type.startsWith('image/')) {
        return reject(new Error('请选择或粘贴图片文件'));
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          let width = img.width;
          let height = img.height;
          if (width > maxWidth) {
            height = Math.round((height * maxWidth) / width);
            width = maxWidth;
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          resolve(dataUrl);
        };
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(new Error('读取文件失败'));
      reader.readAsDataURL(file);
    });
  }

  // Bind Image Drag & Drop, Paste, and Click Events
  function bindImageInputEvents(inputAreaEl, textareaEl, fileInputEl, btnImageEl, sendImageCallback) {
    // Click button to select image
    btnImageEl.addEventListener('click', () => {
      if (!btnImageEl.disabled) {
        fileInputEl.click();
      }
    });

    // File input change
    fileInputEl.addEventListener('change', async () => {
      if (fileInputEl.files && fileInputEl.files[0]) {
        try {
          const dataUrl = await compressAndReadImage(fileInputEl.files[0]);
          sendImageCallback(dataUrl);
        } catch (err) {
          alert(err.message);
        }
        fileInputEl.value = '';
      }
    });

    // Paste image from clipboard
    textareaEl.addEventListener('paste', async (e) => {
      const items = (e.clipboardData || e.originalEvent.clipboardData)?.items;
      if (!items) return;
      for (let item of items) {
        if (item.type && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            try {
              const dataUrl = await compressAndReadImage(file);
              sendImageCallback(dataUrl);
            } catch (err) {
              alert(err.message);
            }
          }
          break;
        }
      }
    });

    // Drag and Drop
    inputAreaEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      inputAreaEl.classList.add('drag-over');
    });

    inputAreaEl.addEventListener('dragleave', (e) => {
      e.preventDefault();
      inputAreaEl.classList.remove('drag-over');
    });

    inputAreaEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      inputAreaEl.classList.remove('drag-over');
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type && file.type.startsWith('image/')) {
          try {
            const dataUrl = await compressAndReadImage(file);
            sendImageCallback(dataUrl);
          } catch (err) {
            alert(err.message);
          }
        }
      }
    });
  }

  // Prevent browser default window drop (prevents browser from navigating away if image is dropped outside)
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => e.preventDefault());

  // Bind Full Window Image Drag & Drop Helper
  function bindFullWindowDragDrop(containerEl, overlayEl, sendImageCallback, preCheckCallback = null) {
    if (!containerEl || !overlayEl) return;
    let dragCounter = 0;

    containerEl.addEventListener('dragenter', (e) => {
      e.preventDefault();
      const types = Array.from(e.dataTransfer?.types || []);
      if (types.includes('Files')) {
        dragCounter++;
        if (typeof preCheckCallback === 'function') {
          preCheckCallback(false);
        }
        overlayEl.classList.add('active');
      }
    });

    containerEl.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    containerEl.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        overlayEl.classList.remove('active');
      }
    });

    containerEl.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      overlayEl.classList.remove('active');

      if (typeof preCheckCallback === 'function' && !preCheckCallback(true)) {
        return;
      }

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type && file.type.startsWith('image/')) {
          try {
            const dataUrl = await compressAndReadImage(file);
            sendImageCallback(dataUrl);
          } catch (err) {
            alert(err.message || '读取图片失败');
          }
        } else {
          if (currentRole === 'user') {
            sendUserFileRequest(file);
          } else if (currentRole === 'admin' && adminSelectedClientId) {
            sendAdminFileDirectly(file);
          } else if (currentRole === 'admin' && !adminSelectedClientId) {
            alert('请先在左侧侧边栏选择一个用户！');
          }
        }
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
          if (typeof res.adminOnline === 'boolean') {
            updateAdminStatusUI(res.adminOnline);
          }
          if (res.historyMessages) {
            syncUserOfflineMessages(res.historyMessages);
          }
        }
      });
    } else if (currentRole === 'admin' && currentAdminKey) {
      socket.emit('join-admin', { secretKey: currentAdminKey }, (res) => {
        if (res && res.success) {
          if (res.allMessages) {
            syncAdminOfflineMessages(res.allMessages);
          }
          if (res.users) {
            updateAdminUsersMap(res.users);
            renderAdminUserList();
          }
        }
      });
    }
  });

  window.addEventListener('beforeunload', () => {
    if (currentRole === 'user') {
      socket.emit('leave-user');
    }
  });

  // =========================================================================
  // Browser System Notification & Web Audio Sound Manager
  // =========================================================================
  function requestNotificationPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(permission => {
        console.log('[NOTIFICATION] Permission state:', permission);
      });
    }
  }

  function playNotificationSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
      console.log('Notification audio play blocked or unsupported', e);
    }
  }

  function sendDesktopNotification(title, options = {}, onClickCallback = null) {
    playNotificationSound();

    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    try {
      const notif = new Notification(title, {
        icon: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">💬</text></svg>',
        ...options
      });

      notif.onclick = () => {
        window.focus();
        if (typeof onClickCallback === 'function') {
          onClickCallback();
        }
        notif.close();
      };
    } catch (e) {
      console.error('Failed to dispatch notification', e);
    }
  }

  // =========================================================================
  // Secret Trigger Code Listener for Admin Login
  // =========================================================================
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
    showError('🎉 管理员暗号已触发！请输入管理员密码登录');
    inputAdminKey.focus();
    keySequence = '';
  }

  // =========================================================================
  // Initial Local Storage Check
  // =========================================================================
  const savedProfile = ChatStorageManager.getProfile();
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
          if (typeof joinRes.adminOnline === 'boolean') updateAdminStatusUI(joinRes.adminOnline);
          if (joinRes.historyMessages) syncUserOfflineMessages(joinRes.historyMessages);
          initUserView();
        }
      });
    } else if (savedProfile.role === 'admin' && savedProfile.adminKey) {
      inputAdminKey.value = savedProfile.adminKey;
      currentRole = 'admin';
      currentAdminKey = savedProfile.adminKey;
      revealAdminLogin();
      socket.emit('join-admin', { secretKey: savedProfile.adminKey }, (res) => {
        if (res && res.success) {
          if (res.allMessages) syncAdminOfflineMessages(res.allMessages);
          initAdminView(res.users || []);
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

  // =========================================================================
  // Role Switch Tabs
  // =========================================================================
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
      const key = ChatStorageManager.getChatKey(myDeviceId, 'user');
      const existingLocal = ChatStorageManager.getMessages(myDeviceId, 'user');
      if (existingLocal.length > 0) {
        localStorage.removeItem(key);
        if (currentRole === 'user') renderUserMessages();
      }
      return;
    }
    const existingLocal = ChatStorageManager.getMessages(myDeviceId, 'user');
    const localMap = new Map(existingLocal.map(m => [m.id, m]));
    historyMessages.forEach(srvMsg => {
      localMap.set(srvMsg.id, srvMsg);
    });
    const merged = Array.from(localMap.values()).sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const key = ChatStorageManager.getChatKey(myDeviceId, 'user');
    localStorage.setItem(key, JSON.stringify(merged));

    merged.forEach(async (m) => {
      const parsed = parseFileMsg(m);
      if (parsed && parsed.fileStatus === 'approved') {
        let file = pendingFilesMap.get(m.id);
        if (!file && window.IDBFileStore) {
          file = await IDBFileStore.getFile(m.id);
        }
        if (file) {
          try {
            await uploadFileToServer(file, m.id, myDeviceId);
            pendingFilesMap.delete(m.id);
            if (window.IDBFileStore) await IDBFileStore.deleteFile(m.id);
          } catch (err) {
            console.error('Failed auto upload for approved file', err);
          }
        }
      }
    });

    if (currentRole === 'user') {
      renderUserMessages();
    }
  }

  function syncAdminOfflineMessages(allMessages) {
    if (!allMessages || typeof allMessages !== 'object') return;
    Object.keys(allMessages).forEach(cId => {
      const srvMsgs = allMessages[cId];
      if (Array.isArray(srvMsgs) && srvMsgs.length > 0) {
        const existingLocal = ChatStorageManager.getMessages(cId, 'admin');
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
        const key = ChatStorageManager.getChatKey(cId, 'admin');
        localStorage.setItem(key, JSON.stringify(merged));

        if (newCount > 0 && cId !== adminSelectedClientId) {
          for (let i = 0; i < newCount; i++) {
            ChatStorageManager.incrementUnreadCount(cId);
          }
        }
      }
    });

    if (currentRole === 'admin') {
      renderAdminUserList();
      if (adminSelectedClientId) {
        renderAdminChat();
      }
    }
  }

  // =========================================================================
  // User Login Submit
  // =========================================================================
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
        ChatStorageManager.saveProfile({ role: 'user', nickname, reason, deviceId: myDeviceId });

        if (typeof joinRes.adminOnline === 'boolean') {
          updateAdminStatusUI(joinRes.adminOnline);
        }

        if (joinRes.historyMessages) {
          syncUserOfflineMessages(joinRes.historyMessages);
        }

        initUserView();
      });
    });
  });

  // =========================================================================
  // Admin Login Submit
  // =========================================================================
  adminLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    hideError();

    const secretKey = inputAdminKey.value.trim();
    if (!secretKey) {
      return showError('请输入管理员密钥');
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
        showError('登录响应超时，请检查管理员密钥或网络状态后重试');
      }
    }, 4000);

    const existingProfile = ChatStorageManager.getProfile();
    const savedToken = existingProfile ? existingProfile.adminToken : null;

    socket.emit('join-admin', { secretKey, token: savedToken }, (res) => {
      if (isResponded) return;
      isResponded = true;
      clearTimeout(timeoutTimer);

      if (btnSubmit) {
        btnSubmit.disabled = false;
        btnSubmit.innerHTML = originalText;
      }

      if (!res || !res.success) {
        return showError((res && res.message) || '管理员密码错误');
      }

      currentRole = 'admin';
      currentAdminKey = secretKey;
      ChatStorageManager.saveProfile({ role: 'admin', adminKey: secretKey, adminToken: res.token });

      if (res.allMessages) {
        syncAdminOfflineMessages(res.allMessages);
      }

      initAdminView(res.users || []);
    });
  });

  btnUserLogout.addEventListener('click', () => {
    if (currentRole === 'user') {
      socket.emit('leave-user');
    }
    ChatStorageManager.clearProfile();
    location.reload();
  });
  
  btnAdminLogout.addEventListener('click', () => {
    ChatStorageManager.clearProfile();
    location.reload();
  });

  // =========================================================================
  // User View Logic
  // =========================================================================
  function updateAdminStatusUI(isOnline) {
    if (isOnline) {
      adminStatusDot.className = 'status-dot online';
      adminStatusText.querySelector('span:last-child').textContent = '在线中';
    } else {
      adminStatusDot.className = 'status-dot';
      adminStatusText.querySelector('span:last-child').textContent = '已离线 (有疑问可留言)';
    }
  }

  function initUserView() {
    modalOverlay.classList.add('hidden');
    userView.classList.remove('hidden');
    adminView.classList.add('hidden');

    userIdentityTag.innerHTML = `<span class="user-pill-icon">👤</span><span class="user-pill-name">${escapeHTML(userProfile.nickname)}</span>`;
    userIdentityTag.title = `当前用户昵称: ${userProfile.nickname}`;
    userReasonDisplay.textContent = userProfile.reason;

    renderUserMessages();

    // User Text input Enter listener
    userInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendUserMessage();
      } else {
        notifyTyping();
      }
    });

    btnUserSend.addEventListener('click', sendUserMessage);

    // Bind User Image Drag, Drop, Paste, File Click
    bindImageInputEvents(
      userInputArea,
      userInput,
      userImageInput,
      btnUserImage,
      (imageDataUrl) => sendUserImageMessage(imageDataUrl)
    );

    // Bind Full Window Image Drag & Drop for User View
    bindFullWindowDragDrop(
      userChatMain,
      userDragOverlay,
      (imageDataUrl) => sendUserImageMessage(imageDataUrl)
    );

    // User File Button Click
    if (btnUserFile && userAnyfileInput) {
      btnUserFile.addEventListener('click', () => userAnyfileInput.click());
      userAnyfileInput.addEventListener('change', () => {
        if (userAnyfileInput.files && userAnyfileInput.files[0]) {
          sendUserFileRequest(userAnyfileInput.files[0]);
          userAnyfileInput.value = '';
        }
      });
    }
  }

  function renderUserMessages() {
    const messages = ChatStorageManager.getMessages(myDeviceId, 'user');
    userMessagesContainer.innerHTML = '';

    if (messages.length === 0) {
      userMessagesContainer.innerHTML = `
        <div class="empty-placeholder">
          <div class="icon">💬</div>
          <p>消息按设备绑定并保存在本地，随时可与管理员沟通！</p>
        </div>`;
      return;
    }

    messages.forEach(msg => {
      appendMessageBubble(userMessagesContainer, msg, msg.senderRole === 'user');
    });

    scrollToBottom(userMessagesContainer);
  }

  function sendUserMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    const msgObj = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      clientId: myDeviceId,
      fromNickname: userProfile.nickname,
      msgType: 'text',
      text: text,
      timestamp: new Date().toISOString(),
      senderRole: 'user'
    };

    ChatStorageManager.saveMessage(myDeviceId, msgObj, 'user');
    renderUserMessages();
    userInput.value = '';

    socket.emit('user-message', msgObj);
  }

  function sendUserImageMessage(imageDataUrl) {
    const msgObj = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      clientId: myDeviceId,
      fromNickname: userProfile.nickname,
      msgType: 'image',
      text: imageDataUrl,
      timestamp: new Date().toISOString(),
      senderRole: 'user'
    };

    ChatStorageManager.saveMessage(myDeviceId, msgObj, 'user');
    renderUserMessages();

    socket.emit('user-message', msgObj);
  }

  // Socket: Admin Status Change -> User View
  socket.on('admin-status-change', ({ online }) => {
    updateAdminStatusUI(online);
  });

  // Socket: Incoming Admin Message -> User View
  socket.on('new-admin-message', (msgObj) => {
    if (currentRole === 'user') {
      ChatStorageManager.saveMessage(myDeviceId, msgObj, 'user');
      renderUserMessages();

      const notifBody = msgObj.text.startsWith('data:image/') ? '[图片消息]' : msgObj.text;
      sendDesktopNotification('💬 来自管理员的新消息', {
        body: notifBody,
        tag: 'admin-reply'
      });
    }
  });

  // Socket: Admin Typing -> User View
  socket.on('admin-typing', ({ isTyping }) => {
    if (currentRole === 'user' && userTypingStatus) {
      userTypingStatus.style.display = isTyping ? 'block' : 'none';
    }
  });

  // Socket: Admin Bilateral Session Deletion -> User View
  socket.on('session-deleted-by-admin', () => {
    if (currentRole === 'user') {
      ChatStorageManager.clearMessages(myDeviceId, 'user');
      renderUserMessages();
      sendDesktopNotification('⚠️ 会话已重置', {
        body: '管理员已彻底清空/双向删除该会话记录',
        tag: 'session-deleted'
      });
    }
  });

  socket.on('session-cleared-by-admin', () => {
    if (currentRole === 'user') {
      ChatStorageManager.clearMessages(myDeviceId, 'user');
      renderUserMessages();
    }
  });

  
  

  // =========================================================================
  // Admin View Logic
  // =========================================================================
  function initAdminView(serverUsers) {
    modalOverlay.classList.add('hidden');
    adminView.classList.remove('hidden');
    userView.classList.add('hidden');

    updateAdminUsersMap(serverUsers);
    renderAdminUserList();

    // Auto-select user with highest unread or first available user if none selected
    if (!adminSelectedClientId && allAdminUsersMap.size > 0) {
      const usersList = Array.from(allAdminUsersMap.values());
      usersList.sort((a, b) => {
        const unreadA = ChatStorageManager.getUnreadCount(a.clientId);
        const unreadB = ChatStorageManager.getUnreadCount(b.clientId);
        if (unreadB !== unreadA) return unreadB - unreadA;
        return (b.online ? 1 : 0) - (a.online ? 1 : 0);
      });
      if (usersList.length > 0) {
        selectUserForAdmin(usersList[0].clientId);
      }
    }

    adminUserSearch.addEventListener('input', () => renderAdminUserList());

    adminInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAdminMessage();
      } else {
        notifyTyping();
      }
    });

    btnAdminSend.addEventListener('click', sendAdminMessage);

    btnClearTargetChat.addEventListener('click', () => {
      if (adminSelectedClientId && confirm(`确定要彻底清空与该设备 (${adminSelectedClientId}) 的本地聊天记录吗？`)) {
        ChatStorageManager.clearMessages(adminSelectedClientId, 'admin');
        renderAdminChat();
      }
    });

    // Bind Admin Image Drag, Drop, Paste, File Click
    bindImageInputEvents(
      adminInputArea,
      adminInput,
      adminImageInput,
      btnAdminImage,
      (imageDataUrl) => sendAdminImageMessage(imageDataUrl)
    );

    // Admin File Button Click
    if (btnAdminFile && adminAnyfileInput) {
      btnAdminFile.addEventListener('click', () => {
        if (!btnAdminFile.disabled) adminAnyfileInput.click();
      });
      adminAnyfileInput.addEventListener('change', () => {
        if (adminAnyfileInput.files && adminAnyfileInput.files[0] && adminSelectedClientId) {
          sendAdminFileDirectly(adminAnyfileInput.files[0]);
          adminAnyfileInput.value = '';
        }
      });
    }

    // Bind Full Window Image Drag & Drop for Admin View
    bindFullWindowDragDrop(
      adminChatMain,
      adminDragOverlay,
      (imageDataUrl) => sendAdminImageMessage(imageDataUrl),
      (isDropping = false) => {
        if (!adminSelectedClientId) {
          if (adminDragTitle) adminDragTitle.textContent = '⚠️ 请先选择目标用户';
          if (adminDragDesc) adminDragDesc.textContent = '请在左侧侧边栏点击选择一个用户后再拖放文件';
          if (adminDragIcon) adminDragIcon.textContent = '⚠️';
          if (isDropping) {
            alert('请先在左侧侧边栏选择一个用户！');
          }
          return false;
        } else {
          const userObj = allAdminUsersMap.get(adminSelectedClientId);
          const targetName = userObj ? userObj.nickname : '用户';
          if (adminDragTitle) adminDragTitle.textContent = '释放文件即可发送';
          if (adminDragDesc) adminDragDesc.textContent = `将发送给: ${targetName}`;
          if (adminDragIcon) adminDragIcon.textContent = '📥';
          return true;
        }
      }
    );
  }

  function updateAdminUsersMap(serverUsers) {
    serverUsers.forEach(u => {
      allAdminUsersMap.set(u.clientId, u);
    });

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('mychat_history_admin_')) {
        const clientIdKey = key.replace('mychat_history_admin_', '');
        const msgs = ChatStorageManager.getMessages(clientIdKey, 'admin');
        if (msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          const reason = lastMsg.reason || '无记录';
          if (!allAdminUsersMap.has(clientIdKey)) {
            allAdminUsersMap.set(clientIdKey, {
              clientId: clientIdKey,
              nickname: lastMsg.fromNickname || '未知设备',
              reason: reason,
              online: false,
              lastSeen: lastMsg.timestamp,
              nicknameHistory: [],
              ipHistory: []
            });
          }
        }
      }
    }
  }

  function renderAdminUserList() {
    const filterText = adminUserSearch.value.trim().toLowerCase();
    adminUserListContainer.innerHTML = '';

    const users = Array.from(allAdminUsersMap.values()).filter(u => {
      return u.nickname.toLowerCase().includes(filterText) || 
             u.clientId.toLowerCase().includes(filterText) ||
             (u.reason && u.reason.toLowerCase().includes(filterText));
    });

    if (users.length === 0) {
      adminUserListContainer.innerHTML = `
        <div class="empty-placeholder" style="margin-top: 30px;">
          <p>未搜到相关设备或用户</p>
        </div>`;
      return;
    }

    users.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));

    users.forEach(u => {
      const isSelected = u.clientId === adminSelectedClientId;
      const unreadCount = ChatStorageManager.getUnreadCount(u.clientId);

      const itemEl = document.createElement('div');
      itemEl.className = `user-item ${isSelected ? 'active' : ''}`;
      itemEl.innerHTML = `
        <div class="user-item-top">
          <span class="user-item-name">
            <span class="status-dot ${u.online ? 'online' : ''}"></span>
            ${escapeHTML(u.nickname)}
            <span style="font-size:10px; color:var(--text-dim); margin-left:4px;" title="设备指纹ID: ${escapeHTML(u.clientId)}">[ID: ${escapeHTML(u.clientId.substring(0, 10))}]</span>
          </span>
          ${unreadCount > 0 ? `<span class="unread-pill">${unreadCount}</span>` : ''}
        </div>
        <div class="user-item-reason" title="${escapeHTML(u.reason || '')}">
          求助: ${escapeHTML(u.reason || '未填写')}
        </div>
      `;

      itemEl.addEventListener('click', () => {
        selectUserForAdmin(u.clientId);
      });

      itemEl.addEventListener('contextmenu', (e) => {
        showContextMenu(e, u.clientId);
      });

      adminUserListContainer.appendChild(itemEl);
    });
  }

  function selectUserForAdmin(clientId) {
    adminSelectedClientId = clientId;
    ChatStorageManager.clearUnreadCount(clientId);
    renderAdminUserList();

    const userObj = allAdminUsersMap.get(clientId);
    const displayName = userObj ? userObj.nickname : '未知设备';

    adminTargetAvatar.textContent = displayName.charAt(0).toUpperCase();
    adminTargetNickname.innerHTML = `${escapeHTML(displayName)} <span style="font-size:11px; font-weight:normal; color:var(--text-dim);">(${escapeHTML(clientId)})</span>`;
    adminTargetStatus.innerHTML = userObj && userObj.online 
      ? `<span class="status-dot online"></span> 状态：在线`
      : `<span class="status-dot"></span> 状态：离线 ${userObj && userObj.lastSeen ? '(上次在线: ' + formatTime(userObj.lastSeen) + ')' : ''}`;

    adminTargetReasonBar.style.display = 'flex';
    adminTargetReasonText.textContent = userObj ? (userObj.reason || '未填写') : '无';
    btnClearTargetChat.style.display = 'inline-flex';

    if (userObj) {
      const nicks = (userObj.nicknameHistory || []).map(n => escapeHTML(n.nickname));
      const ips = (userObj.ipHistory || []).map(i => `${escapeHTML(i.ip_address)} (${formatTime(i.logged_in_at)})`);

      historyNicknamesText.innerHTML = nicks.length > 0 ? nicks.join(' <span style="color:var(--text-dim);">➔</span> ') : escapeHTML(userObj.nickname);
      historyIpsText.innerHTML = ips.length > 0 ? ips.join(' | ') : escapeHTML(userObj.lastIp || '127.0.0.1');
    }

    adminInput.disabled = false;
    btnAdminSend.disabled = false;
    btnAdminImage.disabled = false;
    if (btnAdminFile) btnAdminFile.disabled = false;

    if (adminView) {
      adminView.classList.add('mobile-show-chat');
    }

    renderAdminChat();
  }

  function renderAdminChat() {
    adminMessagesContainer.innerHTML = '';
    if (!adminSelectedClientId) return;

    const messages = ChatStorageManager.getMessages(adminSelectedClientId, 'admin');

    if (messages.length === 0) {
      adminMessagesContainer.innerHTML = `
        <div class="empty-placeholder">
          <div class="icon">💬</div>
          <p>尚无消息记录，主动发一条吧！</p>
        </div>`;
      return;
    }

    messages.forEach(msg => {
      appendMessageBubble(adminMessagesContainer, msg, msg.senderRole === 'admin');
    });

    scrollToBottom(adminMessagesContainer);
  }

  function sendAdminMessage() {
    if (!adminSelectedClientId) return;
    const text = adminInput.value.trim();
    if (!text) return;

    const userObj = allAdminUsersMap.get(adminSelectedClientId);

    const msgObj = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      targetClientId: adminSelectedClientId,
      targetNickname: userObj ? userObj.nickname : '用户',
      fromNickname: '管理员',
      msgType: 'text',
      reason: userObj ? userObj.reason : '',
      text: text,
      timestamp: new Date().toISOString(),
      senderRole: 'admin'
    };

    ChatStorageManager.saveMessage(adminSelectedClientId, msgObj, 'admin');
    renderAdminChat();
    adminInput.value = '';

    socket.emit('admin-message', msgObj);
  }

  function sendAdminImageMessage(imageDataUrl) {
    if (!adminSelectedClientId) return;

    const userObj = allAdminUsersMap.get(adminSelectedClientId);

    const msgObj = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      targetClientId: adminSelectedClientId,
      targetNickname: userObj ? userObj.nickname : '用户',
      fromNickname: '管理员',
      msgType: 'image',
      reason: userObj ? userObj.reason : '',
      text: imageDataUrl,
      timestamp: new Date().toISOString(),
      senderRole: 'admin'
    };

    ChatStorageManager.saveMessage(adminSelectedClientId, msgObj, 'admin');
    renderAdminChat();

    socket.emit('admin-message', msgObj);
  }


  const pendingFilesMap = new Map();

  function uploadFileToServer(file, msgId, targetClientId) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        const fileDataUrl = e.target.result;
        try {
          const resp = await fetch(formatApiUrl('/api/upload'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              fileName: file.name,
              fileDataUrl,
              msgId,
              targetClientId
            })
          });
          const res = await resp.json();
          if (res.success) {
            resolve(res.fileUrl);
          } else {
            reject(new Error(res.message || '上传接口返回失败'));
          }
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('读取本地文件失败'));
      reader.readAsDataURL(file);
    });
  }

  async function sendUserFileRequest(file) {
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) {
      return alert('单个传输文件不能超过 50MB');
    }

    const ext = (file.name || '').split('.').pop().toLowerCase();
    const ALLOWED_EXTENSIONS = new Set([
      'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv',
      'zip', 'rar', '7z', 'tar', 'gz', 'png', 'jpg', 'jpeg', 'gif', 'webp'
    ]);
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return alert('安全阻断：禁止发送可执行脚本或高风险类型文件 (.' + ext + ')');
    }

    const msgId = Date.now() + '-' + Math.random().toString(36).substr(2, 5);

    // Save File in memory map and IndexedDB for offline persistence
    pendingFilesMap.set(msgId, file);
    if (window.IDBFileStore) {
      await IDBFileStore.saveFile(msgId, file);
    }

    const fileDataObj = {
      msgType: 'file',
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      fileStatus: 'pending',
      fileUrl: ''
    };

    const msgObj = {
      id: msgId,
      clientId: myDeviceId,
      fromNickname: userProfile ? userProfile.nickname : '用户',
      msgType: 'file',
      fileData: fileDataObj,
      text: JSON.stringify(fileDataObj),
      timestamp: new Date().toISOString(),
      senderRole: 'user'
    };

    ChatStorageManager.saveMessage(myDeviceId, msgObj, 'user');
    renderUserMessages();

    socket.emit('user-message', msgObj);
  }

  async function sendAdminFileDirectly(file) {
    if (!adminSelectedClientId || !file) return;
    if (file.size > 50 * 1024 * 1024) {
      return alert('单个传输文件不能超过 50MB');
    }

    const userObj = allAdminUsersMap.get(adminSelectedClientId);
    const msgId = Date.now() + '-' + Math.random().toString(36).substr(2, 5);

    const fileDataObj = {
      msgType: 'file',
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      fileStatus: 'approved',
      fileUrl: ''
    };

    const msgObj = {
      id: msgId,
      targetClientId: adminSelectedClientId,
      targetNickname: userObj ? userObj.nickname : '用户',
      fromNickname: '管理员',
      msgType: 'file',
      fileData: fileDataObj,
      text: JSON.stringify(fileDataObj),
      timestamp: new Date().toISOString(),
      senderRole: 'admin'
    };

    ChatStorageManager.saveMessage(adminSelectedClientId, msgObj, 'admin');
    renderAdminChat();

    socket.emit('admin-message', msgObj);

    try {
      await uploadFileToServer(file, msgId, adminSelectedClientId);
    } catch (err) {
      alert('上传文件失败: ' + err.message);
    }
  }

  // Socket: File Request Approval / Rejection Update
  socket.on('file-request-response', async ({ msgId, targetClientId, approved }) => {
    const chatRole = currentRole === 'admin' ? 'admin' : 'user';
    const chatId = currentRole === 'admin' ? targetClientId : myDeviceId;

    const messages = ChatStorageManager.getMessages(chatId, chatRole);
    const targetMsg = messages.find(m => m.id === msgId);
    if (targetMsg) {
      let parsed = parseFileMsg(targetMsg) || {};
      parsed.fileStatus = approved ? 'approved' : 'rejected';
      targetMsg.text = JSON.stringify(parsed);
      targetMsg.fileData = parsed;

      const key = ChatStorageManager.getChatKey(chatId, chatRole);
      localStorage.setItem(key, JSON.stringify(messages));
    }

    if (currentRole === 'user') {
      renderUserMessages();
      if (approved && pendingFilesMap.has(msgId)) {
        const file = pendingFilesMap.get(msgId);
        try {
          await uploadFileToServer(file, msgId, myDeviceId);
          pendingFilesMap.delete(msgId);
        } catch (err) {
          alert('上传文件失败: ' + err.message);
        }
      }
    } else if (currentRole === 'admin' && adminSelectedClientId === targetClientId) {
      renderAdminChat();
    }
  });

  // Socket: File Upload Completed Update
  socket.on('file-upload-finished', ({ msgId, targetClientId, fileUrl, fileData }) => {
    const chatRole = currentRole === 'admin' ? 'admin' : 'user';
    const chatId = currentRole === 'admin' ? targetClientId : myDeviceId;

    const messages = ChatStorageManager.getMessages(chatId, chatRole);
    const targetMsg = messages.find(m => m.id === msgId);
    if (targetMsg) {
      let parsed = parseFileMsg(targetMsg) || {};
      parsed.fileStatus = 'completed';
      parsed.fileUrl = fileUrl;
      targetMsg.text = JSON.stringify(parsed);
      targetMsg.fileData = parsed;

      const key = ChatStorageManager.getChatKey(chatId, chatRole);
      localStorage.setItem(key, JSON.stringify(messages));
    }

    if (currentRole === 'user') {
      renderUserMessages();
    } else if (currentRole === 'admin' && adminSelectedClientId === targetClientId) {
      renderAdminChat();
    }
  });

  socket.on('update-user-list', (userList) => {
    if (currentRole === 'admin') {
      updateAdminUsersMap(userList);
      renderAdminUserList();

      if (adminSelectedClientId) {
        const u = allAdminUsersMap.get(adminSelectedClientId);
        if (u) {
          adminTargetNickname.innerHTML = `${escapeHTML(u.nickname)} <span style="font-size:11px; font-weight:normal; color:var(--text-dim);">(${escapeHTML(u.clientId)})</span>`;
          adminTargetStatus.innerHTML = u.online 
            ? `<span class="status-dot online"></span> 状态：在线`
            : `<span class="status-dot"></span> 状态：离线 ${u.lastSeen ? '(上次在线: ' + formatTime(u.lastSeen) + ')' : ''}`;

          const nicks = (u.nicknameHistory || []).map(n => escapeHTML(n.nickname));
          const ips = (u.ipHistory || []).map(i => `${escapeHTML(i.ip_address)} (${formatTime(i.logged_in_at)})`);

          historyNicknamesText.innerHTML = nicks.length > 0 ? nicks.join(' <span style="color:var(--text-dim);">➔</span> ') : escapeHTML(u.nickname);
          historyIpsText.innerHTML = ips.length > 0 ? ips.join(' | ') : escapeHTML(u.lastIp || '127.0.0.1');
        }
      }
    }
  });

  socket.on('new-user-message', (msgObj) => {
    if (currentRole === 'admin') {
      const clientId = msgObj.clientId;

      if (allAdminUsersMap.has(clientId)) {
        const u = allAdminUsersMap.get(clientId);
        u.nickname = msgObj.fromNickname || u.nickname;
        u.reason = msgObj.reason || u.reason;
        u.online = true;
      } else {
        allAdminUsersMap.set(clientId, {
          clientId: clientId,
          nickname: msgObj.fromNickname,
          reason: msgObj.reason,
          online: true
        });
      }

      ChatStorageManager.saveMessage(clientId, msgObj, 'admin');

      if (adminSelectedClientId === clientId) {
        renderAdminChat();
      } else {
        ChatStorageManager.incrementUnreadCount(clientId);
      }

      renderAdminUserList();

      const fileData = parseFileMsg(msgObj);
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
        selectUserForAdmin(clientId);
      });
    }
  });

  socket.on('user-typing', ({ clientId, nickname, isTyping }) => {
    if (currentRole === 'admin' && adminSelectedClientId === clientId) {
      adminTypingStatus.style.display = isTyping ? 'block' : 'none';
    }
  });

  // =========================================================================
  // Common Utilities & Message Rendering
  // =========================================================================
  
  function formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function getFileIcon(fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    if (['pdf'].includes(ext)) return '📄';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return '📦';
    if (['doc', 'docx', 'txt', 'md'].includes(ext)) return '📝';
    if (['xls', 'xlsx', 'csv'].includes(ext)) return '📊';
    if (['ppt', 'pptx'].includes(ext)) return '📊';
    if (['mp3', 'wav', 'ogg'].includes(ext)) return '🎵';
    if (['mp4', 'avi', 'mkv', 'mov'].includes(ext)) return '🎬';
    if (['exe', 'msi', 'apk', 'dmg'].includes(ext)) return '⚙️';
    return '📁';
  }

  function parseFileMsg(msg) {
    if (msg.msgType === 'file' && typeof msg.fileData === 'object' && msg.fileData) {
      return msg.fileData;
    }
    if (typeof msg.text === 'string' && msg.text.trim().startsWith('{')) {
      try {
        const parsed = JSON.parse(msg.text);
        if (parsed && parsed.msgType === 'file') {
          return parsed;
        }
      } catch (e) {}
    }
    return null;
  }

  function notifyTyping() {
    if (!currentRole) return;

    socket.emit('typing', {
      isTyping: true,
      targetClientId: currentRole === 'admin' ? adminSelectedClientId : null
    });

    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      socket.emit('typing', {
        isTyping: false,
        targetClientId: currentRole === 'admin' ? adminSelectedClientId : null
      });
    }, 1500);
  }

  function appendMessageBubble(container, msg, isSentByMe) {
    const timeStr = formatTime(msg.timestamp);

    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = `message-bubble-wrapper ${isSentByMe ? 'sent' : 'received'}`;
    
    const fileData = parseFileMsg(msg);
    const isImage = !fileData && (msg.msgType === 'image' || (msg.text && typeof msg.text === 'string' && msg.text.startsWith('data:image/')));

    let contentHtml = '';
    if (fileData) {
      const icon = getFileIcon(fileData.fileName);
      const sizeStr = formatFileSize(fileData.fileSize);
      const status = fileData.fileStatus || 'pending';

      let statusBadgeHtml = '';
      let actionsHtml = '';

      if (status === 'pending') {
        statusBadgeHtml = `<span class="file-status-badge pending">⏳ 待管理员审核</span>`;
        if (currentRole === 'admin') {
          actionsHtml = `
            <div class="file-card-actions">
              <button type="button" class="btn-file-action btn-file-approve">✅ 同意接收</button>
              <button type="button" class="btn-file-action btn-file-reject">❌ 拒绝</button>
            </div>
          `;
        } else {
          actionsHtml = `<div style="font-size:12px; color:var(--text-dim); margin-top:4px;">需管理员审核同意后方可开始传输</div>`;
        }
      } else if (status === 'approved') {
        statusBadgeHtml = `<span class="file-status-badge approved">✅ 已同意，传输保存中...</span>`;
      } else if (status === 'rejected') {
        statusBadgeHtml = `<span class="file-status-badge rejected">❌ 管理员已拒绝传输</span>`;
      } else if (status === 'completed') {
        statusBadgeHtml = `<span class="file-status-badge approved">✅ 传输完成</span>`;
        actionsHtml = `
          <div style="margin-top: 6px;">
            <a class="btn-file-download" href="${formatApiUrl(fileData.fileUrl)}" download="${escapeHTML(fileData.fileName)}" target="_blank">📥 下载文件 (${sizeStr})</a>
          </div>
        `;
      }

      contentHtml = `
        <div class="file-card">
          <div class="file-card-header">
            <span class="file-card-icon">${icon}</span>
            <div class="file-card-info">
              <div class="file-card-name" title="${escapeHTML(fileData.fileName)}">${escapeHTML(fileData.fileName)}</div>
              <div class="file-card-size">${sizeStr}</div>
            </div>
          </div>
          ${statusBadgeHtml}
          ${actionsHtml}
        </div>
      `;
    } else if (isImage) {
      contentHtml = `<img class="chat-image-preview" src="${msg.text}" alt="图片消息" title="点击查看大图">`;
    } else {
      contentHtml = escapeHTML(msg.text);
    }

    bubbleWrapper.innerHTML = `
      <div class="message-meta">
        <span>${escapeHTML(isSentByMe ? '我' : (msg.fromNickname || '管理员'))}</span>
        <span>•</span>
        <span>${timeStr}</span>
      </div>
      <div class="message-bubble">${contentHtml}</div>
    `;

    // Click image to open Lightbox
    if (isImage) {
      const imgEl = bubbleWrapper.querySelector('.chat-image-preview');
      if (imgEl) {
        imgEl.addEventListener('click', () => {
          openImageLightbox(msg.text);
        });
      }
    }

    // Admin File Approve / Reject Click Handlers
    if (fileData && fileData.fileStatus === 'pending' && currentRole === 'admin') {
      const btnApprove = bubbleWrapper.querySelector('.btn-file-approve');
      const btnReject = bubbleWrapper.querySelector('.btn-file-reject');

      if (btnApprove) {
        btnApprove.addEventListener('click', () => {
          socket.emit('admin-file-response', {
            msgId: msg.id,
            targetClientId: msg.clientId || msg.targetClientId,
            approved: true
          }, (res) => {
            if (res && !res.success) alert(res.message || '操作失败');
          });
        });
      }

      if (btnReject) {
        btnReject.addEventListener('click', () => {
          socket.emit('admin-file-response', {
            msgId: msg.id,
            targetClientId: msg.clientId || msg.targetClientId,
            approved: false
          }, (res) => {
            if (res && !res.success) alert(res.message || '操作失败');
          });
        });
      }
    }

    container.appendChild(bubbleWrapper);
  }

  function scrollToBottom(container) {
    container.scrollTop = container.scrollHeight;
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  function escapeHTML(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

// =========================================================================
  // Right-Click Context Menu Logic
  // =========================================================================
  function hideContextMenu() {
    if (adminContextMenu) adminContextMenu.classList.add('hidden');
    activeContextClientId = null;
  }

  function showContextMenu(e, clientId) {
    e.preventDefault();
    if (!adminContextMenu) return;

    activeContextClientId = clientId;
    adminContextMenu.classList.remove('hidden');

    const menuWidth = 190;
    const menuHeight = 90;
    let posX = e.clientX;
    let posY = e.clientY;

    if (posX + menuWidth > window.innerWidth) {
      posX = window.innerWidth - menuWidth - 10;
    }
    if (posY + menuHeight > window.innerHeight) {
      posY = window.innerHeight - menuHeight - 10;
    }

    adminContextMenu.style.left = posX + 'px';
    adminContextMenu.style.top = posY + 'px';
  }

  document.addEventListener('click', (e) => {
    if (adminContextMenu && !adminContextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      hideContextMenu();
    }
  });

  if (ctxItemClear) {
    ctxItemClear.addEventListener('click', () => {
      if (activeContextClientId) {
        const cId = activeContextClientId;
        hideContextMenu();
        if (confirm(`确定要彻底清空与设备 (${cId}) 的本地与服务端聊天记录吗？`)) {
          ChatStorageManager.clearMessages(cId, 'admin');
          socket.emit('admin-clear-messages', { targetClientId: cId });
          if (adminSelectedClientId === cId) {
            renderAdminChat();
          }
        }
      }
    });
  }

  if (ctxItemDelete) {
    ctxItemDelete.addEventListener('click', () => {
      if (activeContextClientId) {
        const cId = activeContextClientId;
        hideContextMenu();
        if (confirm(`确定要彻底删除设备 (${cId}) 的会话记录及服务端所有历史记录吗？`)) {
          socket.emit('admin-delete-session', { targetClientId: cId });
          allAdminUsersMap.delete(cId);
          ChatStorageManager.clearMessages(cId, 'admin');
          ChatStorageManager.clearUnreadCount(cId);

          if (adminSelectedClientId === cId) {
            adminSelectedClientId = null;
            adminTargetNickname.textContent = '请选择左侧用户';
            adminTargetStatus.textContent = '选择用户后查看其提问记录';
            adminTargetAvatar.textContent = '?';
            adminTargetReasonBar.style.display = 'none';
            btnClearTargetChat.style.display = 'none';
            adminMessagesContainer.innerHTML = `<div class="empty-placeholder"><div class="icon">👈</div><p>请在左侧侧边栏选择一个用户开始对话</p></div>`;
            adminInput.disabled = true;
            btnAdminSend.disabled = true;
            btnAdminImage.disabled = true;
            if (btnAdminFile) btnAdminFile.disabled = true;
          }

          renderAdminUserList();
        }
      }
    });
  }
});
