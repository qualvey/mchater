/**
 * Admin Customer Module (public/js/modules/admin-customer.js)
 * Encapsulates Admin vs Customer Chat UI, search filtering, user audit drawer, and file approvals.
 */
import { formatApiUrl } from '../core/config.js';
import { sendDesktopNotification, playNotificationSound } from '../core/notif.js';

export class AdminCustomerModule {
  constructor(socket) {
    this.socket = socket;
    this.adminSelectedClientId = null;
    this.allAdminUsersMap = new Map();
    this.currentAdminUsername = null;
    this.currentAdminRole = null;
    this.customersUnreadCount = 0;

    // DOM Elements - Admin View
    this.adminView = document.getElementById('admin-view');
    this.adminChatMain = document.getElementById('admin-chat-main');
    this.adminDragOverlay = document.getElementById('admin-drag-overlay');
    this.adminDragIcon = document.getElementById('admin-drag-icon');
    this.adminDragTitle = document.getElementById('admin-drag-title');
    this.adminDragDesc = document.getElementById('admin-drag-desc');
    this.adminUserListContainer = document.getElementById('admin-user-list');
    this.adminUserSearch = document.getElementById('admin-user-search');
    this.adminMessagesContainer = document.getElementById('admin-messages');
    this.adminInput = document.getElementById('admin-input');
    this.adminInputArea = document.getElementById('admin-input-area');
    this.btnAdminImage = document.getElementById('btn-admin-image');
    this.adminImageInput = document.getElementById('admin-image-input');
    this.btnAdminFile = document.getElementById('btn-admin-file');
    this.adminAnyfileInput = document.getElementById('admin-anyfile-input');
    this.btnAdminSend = document.getElementById('btn-admin-send');
    this.btnClearTargetChat = document.getElementById('btn-clear-target-chat');
    this.adminTargetAvatar = document.getElementById('admin-target-avatar');
    this.adminTargetNickname = document.getElementById('admin-target-nickname');
    this.adminTargetStatus = document.getElementById('admin-target-status');
    this.adminTargetReasonBar = document.getElementById('admin-target-reason-bar');
    this.adminTargetReasonText = document.getElementById('admin-target-reason-text');
    this.adminTypingStatus = document.getElementById('admin-typing-status');
    this.btnToggleUserHistory = document.getElementById('btn-toggle-user-history');
    this.adminUserHistoryPanel = document.getElementById('admin-user-history-panel');
    this.historyNicknamesText = document.getElementById('history-nicknames-text');
    this.historyIpsText = document.getElementById('history-ips-text');
    this.btnMobileBackUsers = document.getElementById('btn-mobile-back-users');
    this.customersUnreadBadge = document.getElementById('customers-unread-badge');

    // Context Menu Elements
    this.adminContextMenu = document.getElementById('admin-context-menu');
    this.ctxItemClear = document.getElementById('ctx-item-clear');
    this.ctxItemDelete = document.getElementById('ctx-item-delete');
    this.activeContextClientId = null;

    this.bindEvents();
  }

  bindEvents() {
    if (this.btnToggleUserHistory && this.adminUserHistoryPanel) {
      this.btnToggleUserHistory.addEventListener('click', () => {
        const isHidden = this.adminUserHistoryPanel.style.display === 'none' || !this.adminUserHistoryPanel.style.display;
        this.adminUserHistoryPanel.style.display = isHidden ? 'block' : 'none';
      });
    }

    if (this.btnMobileBackUsers && this.adminView) {
      this.btnMobileBackUsers.addEventListener('click', () => {
        this.adminView.classList.remove('mobile-show-chat');
      });
    }

    if (this.adminUserSearch) {
      this.adminUserSearch.addEventListener('input', () => {
        this.renderUserList();
      });
    }

    if (this.adminInput) {
      this.adminInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendAdminMessage();
        }
      });
    }

    if (this.btnAdminSend) {
      this.btnAdminSend.addEventListener('click', () => this.sendAdminMessage());
    }

    if (this.btnClearTargetChat) {
      this.btnClearTargetChat.addEventListener('click', () => {
        if (this.adminSelectedClientId && confirm(`确定要彻底清空与该设备 (${this.adminSelectedClientId}) 的本地聊天记录吗？`)) {
          window.ChatStorageManager.clearMessages(this.adminSelectedClientId, 'admin');
          this.renderChat();
        }
      });
    }

    this.bindImageAndFileEvents();
    this.bindContextMenuEvents();
  }

  bindImageAndFileEvents() {
    if (this.btnAdminImage && this.adminImageInput && this.adminInputArea && this.adminInput) {
      this.btnAdminImage.addEventListener('click', () => {
        if (!this.btnAdminImage.disabled) this.adminImageInput.click();
      });

      this.adminImageInput.addEventListener('change', async () => {
        if (this.adminImageInput.files && this.adminImageInput.files[0]) {
          try {
            const dataUrl = await this.compressAndReadImage(this.adminImageInput.files[0]);
            this.sendAdminImageMessage(dataUrl);
          } catch (err) {
            alert(err.message);
          }
          this.adminImageInput.value = '';
        }
      });

      this.adminInput.addEventListener('paste', async (e) => {
        const items = (e.clipboardData || e.originalEvent?.clipboardData)?.items;
        if (!items) return;
        for (let item of items) {
          if (item.type && item.type.startsWith('image/')) {
            e.preventDefault();
            const file = item.getAsFile();
            if (file) {
              try {
                const dataUrl = await this.compressAndReadImage(file);
                this.sendAdminImageMessage(dataUrl);
              } catch (err) {
                alert(err.message);
              }
            }
            break;
          }
        }
      });
    }

    if (this.btnAdminFile && this.adminAnyfileInput) {
      this.btnAdminFile.addEventListener('click', () => {
        if (!this.btnAdminFile.disabled) this.adminAnyfileInput.click();
      });
      this.adminAnyfileInput.addEventListener('change', () => {
        if (this.adminAnyfileInput.files && this.adminAnyfileInput.files[0] && this.adminSelectedClientId) {
          this.sendAdminFileDirectly(this.adminAnyfileInput.files[0]);
          this.adminAnyfileInput.value = '';
        }
      });
    }

    this.bindFullWindowDragDrop();
  }

  bindFullWindowDragDrop() {
    if (!this.adminChatMain || !this.adminDragOverlay) return;
    let dragCounter = 0;

    this.adminChatMain.addEventListener('dragenter', (e) => {
      e.preventDefault();
      const types = Array.from(e.dataTransfer?.types || []);
      if (types.includes('Files')) {
        dragCounter++;
        if (!this.adminSelectedClientId) {
          if (this.adminDragTitle) this.adminDragTitle.textContent = '⚠️ 请先选择目标用户';
          if (this.adminDragDesc) this.adminDragDesc.textContent = '请在左侧侧边栏点击选择一个用户后再拖放文件';
          if (this.adminDragIcon) this.adminDragIcon.textContent = '⚠️';
        } else {
          const userObj = this.allAdminUsersMap.get(this.adminSelectedClientId);
          const targetName = userObj ? userObj.nickname : '用户';
          if (this.adminDragTitle) this.adminDragTitle.textContent = '释放文件即可发送';
          if (this.adminDragDesc) this.adminDragDesc.textContent = `将发送给: ${targetName}`;
          if (this.adminDragIcon) this.adminDragIcon.textContent = '📥';
        }
        this.adminDragOverlay.classList.add('active');
      }
    });

    this.adminChatMain.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    });

    this.adminChatMain.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        this.adminDragOverlay.classList.remove('active');
      }
    });

    this.adminChatMain.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      this.adminDragOverlay.classList.remove('active');

      if (!this.adminSelectedClientId) {
        return alert('请先在左侧侧边栏选择一个用户！');
      }

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        if (file.type && file.type.startsWith('image/')) {
          try {
            const dataUrl = await this.compressAndReadImage(file);
            this.sendAdminImageMessage(dataUrl);
          } catch (err) {
            alert(err.message || '读取图片失败');
          }
        } else {
          this.sendAdminFileDirectly(file);
        }
      }
    });
  }

  bindContextMenuEvents() {
    document.addEventListener('click', (e) => {
      if (this.adminContextMenu && !this.adminContextMenu.contains(e.target)) {
        this.hideContextMenu();
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideContextMenu();
      }
    });

    if (this.ctxItemClear) {
      this.ctxItemClear.addEventListener('click', () => {
        if (this.activeContextClientId) {
          const cId = this.activeContextClientId;
          this.hideContextMenu();
          if (confirm(`确定要彻底清空与设备 (${cId}) 的本地与服务端聊天记录吗？`)) {
            window.ChatStorageManager.clearMessages(cId, 'admin');
            this.socket.emit('admin-clear-messages', { targetClientId: cId });
            if (this.adminSelectedClientId === cId) {
              this.renderChat();
            }
          }
        }
      });
    }

    if (this.ctxItemDelete) {
      this.ctxItemDelete.addEventListener('click', () => {
        if (this.activeContextClientId) {
          const cId = this.activeContextClientId;
          this.hideContextMenu();
          if (confirm(`确定要彻底删除设备 (${cId}) 的会话记录及服务端所有历史记录吗？`)) {
            this.socket.emit('admin-delete-session', { targetClientId: cId });
            this.allAdminUsersMap.delete(cId);
            window.ChatStorageManager.clearMessages(cId, 'admin');
            window.ChatStorageManager.clearUnreadCount(cId);

            if (this.adminSelectedClientId === cId) {
              this.adminSelectedClientId = null;
              this.adminTargetNickname.textContent = '请选择左侧用户';
              this.adminTargetStatus.textContent = '选择用户后查看其提问记录';
              this.adminTargetAvatar.textContent = '?';
              this.adminTargetReasonBar.style.display = 'none';
              this.btnClearTargetChat.style.display = 'none';
              this.adminMessagesContainer.innerHTML = `<div class="empty-placeholder"><div class="icon">👈</div><p>请在左侧侧边栏选择一个用户开始对话</p></div>`;
              this.adminInput.disabled = true;
              this.btnAdminSend.disabled = true;
              this.btnAdminImage.disabled = true;
              if (this.btnAdminFile) this.btnAdminFile.disabled = true;
            }

            this.renderUserList();
          }
        }
      });
    }
  }

  hideContextMenu() {
    if (this.adminContextMenu) this.adminContextMenu.classList.add('hidden');
    this.activeContextClientId = null;
  }

  showContextMenu(e, clientId) {
    e.preventDefault();
    if (!this.adminContextMenu) return;

    this.activeContextClientId = clientId;
    this.adminContextMenu.classList.remove('hidden');

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

    this.adminContextMenu.style.left = posX + 'px';
    this.adminContextMenu.style.top = posY + 'px';
  }

  updateAdminUsersMap(serverUsers) {
    serverUsers.forEach(u => {
      this.allAdminUsersMap.set(u.clientId, u);
    });

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith('mychat_history_admin_')) {
        const clientIdKey = key.replace('mychat_history_admin_', '');
        const msgs = window.ChatStorageManager.getMessages(clientIdKey, 'admin');
        if (msgs.length > 0) {
          const lastMsg = msgs[msgs.length - 1];
          const reason = lastMsg.reason || '无记录';
          if (!this.allAdminUsersMap.has(clientIdKey)) {
            this.allAdminUsersMap.set(clientIdKey, {
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

  renderUserList() {
    if (!this.adminUserListContainer) return;
    const filterText = (this.adminUserSearch ? this.adminUserSearch.value : '').trim().toLowerCase();
    this.adminUserListContainer.innerHTML = '';

    const users = Array.from(this.allAdminUsersMap.values()).filter(u => {
      return u.nickname.toLowerCase().includes(filterText) || 
             u.clientId.toLowerCase().includes(filterText) ||
             (u.reason && u.reason.toLowerCase().includes(filterText));
    });

    if (users.length === 0) {
      this.adminUserListContainer.innerHTML = `
        <div class="empty-placeholder" style="margin-top: 30px;">
          <p>未搜到相关设备或用户</p>
        </div>`;
      return;
    }

    users.sort((a, b) => (b.online ? 1 : 0) - (a.online ? 1 : 0));

    users.forEach(u => {
      const isSelected = u.clientId === this.adminSelectedClientId;
      const unreadCount = window.ChatStorageManager.getUnreadCount(u.clientId);

      const itemEl = document.createElement('div');
      itemEl.className = `user-item ${isSelected ? 'active' : ''}`;
      itemEl.innerHTML = `
        <div class="user-item-top">
          <span class="user-item-name">
            <span class="status-dot ${u.online ? 'online' : ''}"></span>
            ${this.escapeHTML(u.nickname)}
            <span style="font-size:10px; color:var(--text-dim); margin-left:4px;" title="设备指纹ID: ${this.escapeHTML(u.clientId)}">[ID: ${this.escapeHTML(u.clientId.substring(0, 10))}]</span>
          </span>
          ${unreadCount > 0 ? `<span class="unread-pill">${unreadCount}</span>` : ''}
        </div>
        <div class="user-item-reason" title="${this.escapeHTML(u.reason || '')}">
          求助: ${this.escapeHTML(u.reason || '未填写')}
        </div>
      `;

      itemEl.addEventListener('click', () => {
        this.selectUserForAdmin(u.clientId);
      });

      itemEl.addEventListener('contextmenu', (e) => {
        this.showContextMenu(e, u.clientId);
      });

      this.adminUserListContainer.appendChild(itemEl);
    });
  }

  selectUserForAdmin(clientId) {
    this.adminSelectedClientId = clientId;
    window.ChatStorageManager.clearUnreadCount(clientId);
    this.renderUserList();

    const userObj = this.allAdminUsersMap.get(clientId);
    const displayName = userObj ? userObj.nickname : '未知设备';

    this.adminTargetAvatar.textContent = displayName.charAt(0).toUpperCase();
    this.adminTargetNickname.innerHTML = `${this.escapeHTML(displayName)} <span style="font-size:11px; font-weight:normal; color:var(--text-dim);">(${this.escapeHTML(clientId)})</span>`;
    this.adminTargetStatus.innerHTML = userObj && userObj.online 
      ? `<span class="status-dot online"></span> 状态：在线`
      : `<span class="status-dot"></span> 状态：离线 ${userObj && userObj.lastSeen ? '(上次在线: ' + this.formatTime(userObj.lastSeen) + ')' : ''}`;

    this.adminTargetReasonBar.style.display = 'flex';
    this.adminTargetReasonText.textContent = userObj ? (userObj.reason || '未填写') : '无';
    this.btnClearTargetChat.style.display = 'inline-flex';

    if (userObj) {
      const nicks = (userObj.nicknameHistory || []).map(n => this.escapeHTML(n.nickname));
      const ips = (userObj.ipHistory || []).map(i => `${this.escapeHTML(i.ip_address)} (${this.formatTime(i.logged_in_at)})`);

      this.historyNicknamesText.innerHTML = nicks.length > 0 ? nicks.join(' <span style="color:var(--text-dim);">➔</span> ') : this.escapeHTML(userObj.nickname);
      this.historyIpsText.innerHTML = ips.length > 0 ? ips.join(' | ') : this.escapeHTML(userObj.lastIp || '127.0.0.1');
    }

    this.adminInput.disabled = false;
    this.btnAdminSend.disabled = false;
    this.btnAdminImage.disabled = false;
    if (this.btnAdminFile) this.btnAdminFile.disabled = false;

    if (this.adminView) {
      this.adminView.classList.add('mobile-show-chat');
    }

    this.renderChat();
  }

  renderChat() {
    if (!this.adminMessagesContainer) return;
    this.adminMessagesContainer.innerHTML = '';
    if (!this.adminSelectedClientId) return;

    const messages = window.ChatStorageManager.getMessages(this.adminSelectedClientId, 'admin');

    if (messages.length === 0) {
      this.adminMessagesContainer.innerHTML = `
        <div class="empty-placeholder">
          <div class="icon">💬</div>
          <p>尚无消息记录，主动发一条吧！</p>
        </div>`;
      return;
    }

    messages.forEach(msg => {
      this.appendMessageBubble(msg, msg.senderRole === 'admin');
    });

    this.adminMessagesContainer.scrollTop = this.adminMessagesContainer.scrollHeight;
  }

  sendAdminMessage() {
    const text = this.adminInput.value.trim();
    if (!text || !this.adminSelectedClientId) return;

    const userObj = this.allAdminUsersMap.get(this.adminSelectedClientId);

    const msgObj = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      targetClientId: this.adminSelectedClientId,
      targetNickname: userObj ? userObj.nickname : '用户',
      fromNickname: '管理员',
      msgType: 'text',
      reason: userObj ? userObj.reason : '',
      text: text,
      timestamp: new Date().toISOString(),
      senderRole: 'admin'
    };

    window.ChatStorageManager.saveMessage(this.adminSelectedClientId, msgObj, 'admin');
    this.renderChat();
    this.adminInput.value = '';

    this.socket.emit('admin-message', msgObj);
  }

  sendAdminImageMessage(imageDataUrl) {
    if (!this.adminSelectedClientId) return;

    const userObj = this.allAdminUsersMap.get(this.adminSelectedClientId);

    const msgObj = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      targetClientId: this.adminSelectedClientId,
      targetNickname: userObj ? userObj.nickname : '用户',
      fromNickname: '管理员',
      msgType: 'image',
      reason: userObj ? userObj.reason : '',
      text: imageDataUrl,
      timestamp: new Date().toISOString(),
      senderRole: 'admin'
    };

    window.ChatStorageManager.saveMessage(this.adminSelectedClientId, msgObj, 'admin');
    this.renderChat();

    this.socket.emit('admin-message', msgObj);
  }

  async sendAdminFileDirectly(file) {
    if (!this.adminSelectedClientId || !file) return;
    if (file.size > 50 * 1024 * 1024) {
      return alert('单个传输文件不能超过 50MB');
    }

    const userObj = this.allAdminUsersMap.get(this.adminSelectedClientId);
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
      targetClientId: this.adminSelectedClientId,
      targetNickname: userObj ? userObj.nickname : '用户',
      fromNickname: '管理员',
      msgType: 'file',
      fileData: fileDataObj,
      text: JSON.stringify(fileDataObj),
      timestamp: new Date().toISOString(),
      senderRole: 'admin'
    };

    window.ChatStorageManager.saveMessage(this.adminSelectedClientId, msgObj, 'admin');
    this.renderChat();

    this.socket.emit('admin-message', msgObj);

    try {
      await this.uploadFileToServer(file, msgId, this.adminSelectedClientId);
    } catch (err) {
      alert('上传文件失败: ' + err.message);
    }
  }

  uploadFileToServer(file, msgId, targetClientId) {
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
        actionsHtml = `
          <div class="file-card-actions">
            <button type="button" class="btn-file-action btn-file-approve">✅ 同意接收</button>
            <button type="button" class="btn-file-action btn-file-reject">❌ 拒绝</button>
          </div>
        `;
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
        <span>${this.escapeHTML(isSentByMe ? '我' : (msg.fromNickname || '用户'))}</span>
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

    if (fileData && fileData.fileStatus === 'pending') {
      const btnApprove = bubbleWrapper.querySelector('.btn-file-approve');
      const btnReject = bubbleWrapper.querySelector('.btn-file-reject');

      if (btnApprove) {
        btnApprove.addEventListener('click', () => {
          this.socket.emit('admin-file-response', {
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
          this.socket.emit('admin-file-response', {
            msgId: msg.id,
            targetClientId: msg.clientId || msg.targetClientId,
            approved: false
          }, (res) => {
            if (res && !res.success) alert(res.message || '操作失败');
          });
        });
      }
    }

    this.adminMessagesContainer.appendChild(bubbleWrapper);
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
