/**
 * User Chat Module (public/js/modules/user-chat.js)
 * Encapsulates end-user chat UI, agent selector dropdown, message sending & offline persistence.
 */
import { formatApiUrl } from '../core/config.js';
import { sendDesktopNotification } from '../core/notif.js';

export class UserChatModule {
  constructor(socket, myDeviceId) {
    this.socket = socket;
    this.myDeviceId = myDeviceId;
    this.userProfile = null;
    this.selectedTargetAdmin = 'all';
    this.availableAdminsList = [];
    this.pendingFilesMap = new Map();

    // DOM Elements
    this.userView = document.getElementById('user-view');
    this.userChatMain = document.getElementById('user-chat-main');
    this.userDragOverlay = document.getElementById('user-drag-overlay');
    this.userIdentityTag = document.getElementById('user-identity-tag');
    this.userReasonDisplay = document.getElementById('user-reason-display');
    this.userMessagesContainer = document.getElementById('user-messages');
    this.userInput = document.getElementById('user-input');
    this.userInputArea = document.getElementById('user-input-area');
    this.btnUserImage = document.getElementById('btn-user-image');
    this.userImageInput = document.getElementById('user-image-input');
    this.btnUserFile = document.getElementById('btn-user-file');
    this.userAnyfileInput = document.getElementById('user-anyfile-input');
    this.btnUserSend = document.getElementById('btn-user-send');
    this.adminStatusDot = document.getElementById('admin-status-dot');
    this.userTypingStatus = document.getElementById('user-typing-status');
    this.btnToggleAdminSelector = document.getElementById('btn-toggle-admin-selector');
    this.currentTargetAdminName = document.getElementById('current-target-admin-name');
    this.adminSelectorDropdown = document.getElementById('admin-selector-dropdown');
    this.adminOptionList = document.getElementById('admin-option-list');
    this.adminStatusLabel = document.getElementById('admin-status-label');
    this.currentTargetAvatar = document.getElementById('current-target-avatar');

    this.bindEvents();
  }

  bindEvents() {
    if (this.btnToggleAdminSelector) {
      this.btnToggleAdminSelector.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.adminSelectorDropdown) {
          const isOpening = this.adminSelectorDropdown.classList.contains('hidden');
          this.adminSelectorDropdown.classList.toggle('hidden');
          if (isOpening) {
            this.fetchAdminList();
          }
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (this.adminSelectorDropdown && 
          !this.adminSelectorDropdown.contains(e.target) && 
          this.btnToggleAdminSelector && 
          !this.btnToggleAdminSelector.contains(e.target)) {
        this.adminSelectorDropdown.classList.add('hidden');
      }
    });

    if (this.userInput) {
      this.userInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendTextMessage();
        }
      });
    }

    if (this.btnUserSend) {
      this.btnUserSend.addEventListener('click', () => this.sendTextMessage());
    }

    if (this.btnUserFile && this.userAnyfileInput) {
      this.btnUserFile.addEventListener('click', () => this.userAnyfileInput.click());
      this.userAnyfileInput.addEventListener('change', () => {
        if (this.userAnyfileInput.files && this.userAnyfileInput.files[0]) {
          this.sendUserFileRequest(this.userAnyfileInput.files[0]);
          this.userAnyfileInput.value = '';
        }
      });
    }

    this.bindImageEvents();
    this.bindDragDrop();
  }

  bindImageEvents() {
    if (!this.btnUserImage || !this.userImageInput || !this.userInput) return;

    this.btnUserImage.addEventListener('click', () => {
      if (!this.btnUserImage.disabled) {
        this.userImageInput.click();
      }
    });

    this.userImageInput.addEventListener('change', async () => {
      if (this.userImageInput.files && this.userImageInput.files[0]) {
        try {
          const dataUrl = await this.compressAndReadImage(this.userImageInput.files[0]);
          this.sendImageMessage(dataUrl);
        } catch (err) {
          alert(err.message);
        }
        this.userImageInput.value = '';
      }
    });

    this.userInput.addEventListener('paste', async (e) => {
      const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
      if (!items) return;
      for (let item of items) {
        if (item.type && item.type.startsWith('image/')) {
          e.preventDefault();
          const file = item.getAsFile();
          if (file) {
            try {
              const dataUrl = await this.compressAndReadImage(file);
              this.sendImageMessage(dataUrl);
            } catch (err) {
              alert(err.message);
            }
          }
          break;
        }
      }
    });
  }

  bindDragDrop() {
    if (!this.userChatMain || !this.userDragOverlay) return;
    let dragCounter = 0;

    this.userChatMain.addEventListener('dragenter', (e) => {
      e.preventDefault();
      const types = Array.from(e.dataTransfer?.types || []);
      if (types.includes('Files')) {
        dragCounter++;
        this.userDragOverlay.classList.add('active');
      }
    });

    this.userChatMain.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    this.userChatMain.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        this.userDragOverlay.classList.remove('active');
      }
    });

    this.userChatMain.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      this.userDragOverlay.classList.remove('active');

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type && file.type.startsWith('image/')) {
          try {
            const dataUrl = await this.compressAndReadImage(file);
            this.sendImageMessage(dataUrl);
          } catch (err) {
            alert(err.message || '读取图片失败');
          }
        } else {
          this.sendUserFileRequest(file);
        }
      }
    });
  }

  compressAndReadImage(file, maxWidth = 1200, quality = 0.75) {
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

  initView(profile) {
    this.userProfile = profile;
    if (this.userIdentityTag) {
      this.userIdentityTag.innerHTML = `<span class="user-pill-icon">👤</span><span class="user-pill-name">${this.escapeHTML(profile.nickname)}</span>`;
      this.userIdentityTag.title = `当前用户昵称: ${profile.nickname}`;
    }
    if (this.userReasonDisplay) {
      this.userReasonDisplay.textContent = profile.reason;
    }
    this.fetchAdminList();
    this.renderMessages();
  }

  updateAdminStatusUI(data) {
    let isOnline = false;
    if (typeof data === 'boolean') {
      isOnline = data;
    } else if (data && typeof data === 'object') {
      isOnline = Boolean(data.online);
      if (Array.isArray(data.adminList)) {
        this.availableAdminsList = data.adminList;
      }
    }

    if (this.adminStatusDot) this.adminStatusDot.className = isOnline ? 'status-dot online' : 'status-dot';
    if (this.adminStatusLabel) this.adminStatusLabel.textContent = isOnline ? '客服团队在线中' : '客服已离线 (有疑问可留言)';

    this.renderAdminSelectorDropdown();
  }

  renderAdminSelectorDropdown() {
    if (!this.adminOptionList) return;
    this.adminOptionList.innerHTML = '';

    const autoDiv = document.createElement('div');
    const isAutoSel = this.selectedTargetAdmin === 'all';
    const anyOnline = this.availableAdminsList.some(a => a.online);
    autoDiv.className = `admin-option-item ${isAutoSel ? 'selected' : ''}`;
    autoDiv.innerHTML = `
      <div class="admin-option-info">
        <span class="status-dot ${anyOnline ? 'online' : ''}"></span>
        <span>在线客服团队 (自动推荐)</span>
      </div>
      <span style="font-size:11px; color:var(--text-dim);">默认推荐</span>
    `;
    autoDiv.addEventListener('click', () => this.selectTargetAdmin('all', '在线客服团队 (自动)'));
    this.adminOptionList.appendChild(autoDiv);

    this.availableAdminsList.forEach(adm => {
      const itemDiv = document.createElement('div');
      const isSel = this.selectedTargetAdmin === adm.username;
      itemDiv.className = `admin-option-item ${isSel ? 'selected' : ''}`;
      const roleLabel = adm.role === 'super_admin' ? '主管' : '客服';
      const displayName = adm.displayName || adm.username;
      itemDiv.innerHTML = `
        <div class="admin-option-info">
          <img src="${this.createAvatarSvg(displayName, adm.role)}" class="user-avatar-img sm" style="margin-right: 6px;" />
          <span class="status-dot ${adm.online ? 'online' : ''}"></span>
          <span>${this.escapeHTML(displayName)}</span>
        </div>
        <span style="font-size:11px; color:${adm.online ? 'var(--accent-cyan)' : 'var(--text-dim)'};">${roleLabel} (${adm.online ? '在线' : '离线'})</span>
      `;
      itemDiv.addEventListener('click', () => this.selectTargetAdmin(adm.username, `专属客服: ${displayName}`));
      this.adminOptionList.appendChild(itemDiv);
    });
  }

  selectTargetAdmin(username, displayName) {
    this.selectedTargetAdmin = username;
    if (this.currentTargetAdminName) this.currentTargetAdminName.textContent = displayName;
    if (this.currentTargetAvatar) this.currentTargetAvatar.textContent = username === 'all' ? '🎧' : '👤';
    if (this.adminSelectorDropdown) this.adminSelectorDropdown.classList.add('hidden');
    this.renderAdminSelectorDropdown();
  }

  fetchAdminList() {
    if (this.socket && this.socket.connected) {
      this.socket.emit('get-admin-list', (res) => {
        if (res && res.adminList) {
          this.updateAdminStatusUI(res);
        }
      });
    }
    fetch(formatApiUrl('/api/admins'))
      .then(r => r.json())
      .then(res => {
        if (res && res.success && Array.isArray(res.adminList)) {
          this.updateAdminStatusUI(res);
        }
      })
      .catch(err => console.error('[FETCH ADMINS ERROR]', err));
  }

  sendTextMessage() {
    const text = this.userInput.value.trim();
    if (!text) return;

    const msgObj = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      clientId: this.myDeviceId,
      fromNickname: this.userProfile.nickname,
      msgType: 'text',
      text: text,
      timestamp: new Date().toISOString(),
      senderRole: 'user',
      targetAdminUsername: this.selectedTargetAdmin === 'all' ? null : this.selectedTargetAdmin
    };

    window.ChatStorageManager.saveMessage(this.myDeviceId, msgObj, 'user');
    this.renderMessages();
    this.userInput.value = '';

    this.socket.emit('user-message', msgObj);
  }

  sendImageMessage(imageDataUrl) {
    const msgObj = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      clientId: this.myDeviceId,
      fromNickname: this.userProfile.nickname,
      msgType: 'image',
      text: imageDataUrl,
      timestamp: new Date().toISOString(),
      senderRole: 'user',
      targetAdminUsername: this.selectedTargetAdmin === 'all' ? null : this.selectedTargetAdmin
    };

    window.ChatStorageManager.saveMessage(this.myDeviceId, msgObj, 'user');
    this.renderMessages();

    this.socket.emit('user-message', msgObj);
  }

  async sendUserFileRequest(file) {
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
    this.pendingFilesMap.set(msgId, file);

    if (window.IDBFileStore) {
      await window.IDBFileStore.saveFile(msgId, file);
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
      clientId: this.myDeviceId,
      fromNickname: this.userProfile ? this.userProfile.nickname : '用户',
      msgType: 'file',
      fileData: fileDataObj,
      text: JSON.stringify(fileDataObj),
      timestamp: new Date().toISOString(),
      senderRole: 'user'
    };

    window.ChatStorageManager.saveMessage(this.myDeviceId, msgObj, 'user');
    this.renderMessages();

    this.socket.emit('user-message', msgObj);
  }

  renderMessages() {
    const messages = window.ChatStorageManager.getMessages(this.myDeviceId, 'user');
    if (!this.userMessagesContainer) return;
    this.userMessagesContainer.innerHTML = '';

    if (messages.length === 0) {
      this.userMessagesContainer.innerHTML = `
        <div class="empty-placeholder">
          <div class="icon">💬</div>
          <p>消息按设备绑定并保存在本地，随时可与管理员沟通！</p>
        </div>`;
      return;
    }

    messages.forEach(msg => {
      this.appendMessageBubble(msg, msg.senderRole === 'user');
    });

    this.userMessagesContainer.scrollTop = this.userMessagesContainer.scrollHeight;
  }

  appendMessageBubble(msg, isSentByMe) {
    const timeStr = this.formatTime(msg.timestamp);
    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = `message-bubble-wrapper ${isSentByMe ? 'sent' : 'received'}`;
    
    const fileData = this.parseFileMsg(msg);
    const isImage = !fileData && (msg.msgType === 'image' || (msg.text && typeof msg.text === 'string' && msg.text.startsWith('data:image/')));

    let contentHtml = '';
    if (fileData) {
      const icon = this.getFileIcon(fileData.fileName);
      const sizeStr = this.formatFileSize(fileData.fileSize);
      const status = fileData.fileStatus || 'pending';

      let statusBadgeHtml = '';
      let actionsHtml = '';

      if (status === 'pending') {
        statusBadgeHtml = `<span class="file-status-badge pending">⏳ 待管理员审核</span>`;
        actionsHtml = `<div style="font-size:12px; color:var(--text-dim); margin-top:4px;">需管理员审核同意后方可开始传输</div>`;
      } else if (status === 'approved') {
        statusBadgeHtml = `<span class="file-status-badge approved">✅ 已同意，传输保存中...</span>`;
      } else if (status === 'rejected') {
        statusBadgeHtml = `<span class="file-status-badge rejected">❌ 管理员已拒绝传输</span>`;
      } else if (status === 'completed') {
        statusBadgeHtml = `<span class="file-status-badge approved">✅ 传输完成</span>`;
        actionsHtml = `
          <div style="margin-top: 6px;">
            <a class="btn-file-download" href="${formatApiUrl(fileData.fileUrl)}" download="${this.escapeHTML(fileData.fileName)}" target="_blank">📥 下载文件 (${sizeStr})</a>
          </div>
        `;
      }

      contentHtml = `
        <div class="file-card">
          <div class="file-card-header">
            <span class="file-card-icon">${icon}</span>
            <div class="file-card-info">
              <div class="file-card-name" title="${this.escapeHTML(fileData.fileName)}">${this.escapeHTML(fileData.fileName)}</div>
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
      contentHtml = this.escapeHTML(msg.text);
    }

    bubbleWrapper.innerHTML = `
      <div class="message-meta">
        <span>${this.escapeHTML(isSentByMe ? '我' : (msg.fromNickname || '管理员'))}</span>
        <span>•</span>
        <span>${timeStr}</span>
      </div>
      <div class="message-bubble">${contentHtml}</div>
    `;

    if (isImage) {
      const imgEl = bubbleWrapper.querySelector('.chat-image-preview');
      if (imgEl) {
        imgEl.addEventListener('click', () => {
          const lightboxModal = document.getElementById('image-lightbox-modal');
          const lightboxImage = document.getElementById('lightbox-image-element');
          if (lightboxModal && lightboxImage) {
            lightboxImage.src = msg.text;
            lightboxModal.classList.remove('hidden');
          }
        });
      }
    }

    this.userMessagesContainer.appendChild(bubbleWrapper);
  }

  stringToHslColor(str, s = 65, l = 55) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash) % 360;
    return `hsl(${h}, ${s}%, ${l}%)`;
  }

  createAvatarSvg(name, role = 'user') {
    const initial = String(name || 'U').trim().charAt(0).toUpperCase();
    const bg1 = this.stringToHslColor(name || 'user', 70, 50);
    const bg2 = this.stringToHslColor((name || 'user') + 'rev', 80, 40);

    let icon = '👤';
    if (role === 'super_admin') icon = '👑';
    else if (role === 'admin') icon = '🎧';

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
      <defs>
        <linearGradient id="grad_${initial}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${bg1}" />
          <stop offset="100%" stop-color="${bg2}" />
        </linearGradient>
      </defs>
      <circle cx="50" cy="50" r="48" fill="url(#grad_${initial})" stroke="rgba(255,255,255,0.25)" stroke-width="3" />
      <text x="50" y="54" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-size="40" font-weight="bold" fill="#ffffff" text-anchor="middle" dominant-baseline="central">${initial}</text>
      <circle cx="76" cy="76" r="18" fill="#1e293b" stroke="#ffffff" stroke-width="2" />
      <text x="76" y="76" font-size="15" text-anchor="middle" dominant-baseline="central">${icon}</text>
    </svg>`;

    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  formatFileSize(bytes) {
    if (!bytes || isNaN(bytes)) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  getFileIcon(fileName) {
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

  parseFileMsg(msg) {
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

  formatTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  escapeHTML(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
