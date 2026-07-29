/**
 * Admin Team Module (public/js/modules/admin-team.js)
 * Encapsulates Admin Team Internal Communication (Lobby & Private Chat), Account Management & Password Self-Service.
 */
import { formatApiUrl } from '../core/config.js';
import { sendDesktopNotification, playNotificationSound } from '../core/notif.js';

export class AdminTeamModule {
  constructor(socket) {
    this.socket = socket;
    this.adminInternalTarget = 'ALL'; // 'ALL' | username
    this.allAdminInternalMessages = [];
    this.teamUnreadCount = 0;
    this.currentAdminUsername = null;
    this.currentAdminRole = null;
    this.availableAdminsList = [];

    // DOM Elements
    this.adminView = document.getElementById('admin-view');
    this.adminTabCustomers = document.getElementById('admin-tab-customers');
    this.adminTabTeam = document.getElementById('admin-tab-team');
    this.customersUnreadBadge = document.getElementById('customers-unread-badge');
    this.teamUnreadBadge = document.getElementById('team-unread-badge');
    this.adminUserList = document.getElementById('admin-user-list');
    this.adminTeamList = document.getElementById('admin-team-list');
    this.adminUserSearch = document.getElementById('admin-user-search');
    this.adminMessagesContainer = document.getElementById('admin-messages');
    this.adminInput = document.getElementById('admin-input');
    this.btnAdminSend = document.getElementById('btn-admin-send');
    this.btnAdminImage = document.getElementById('btn-admin-image');
    this.btnAdminFile = document.getElementById('btn-admin-file');
    this.btnClearTargetChat = document.getElementById('btn-clear-target-chat');
    this.adminTargetAvatar = document.getElementById('admin-target-avatar');
    this.adminTargetNickname = document.getElementById('admin-target-nickname');
    this.adminTargetStatus = document.getElementById('admin-target-status');
    this.adminTargetReasonBar = document.getElementById('admin-target-reason-bar');
    this.adminRoleBadge = document.getElementById('admin-role-badge');
    this.btnAdminManageUsers = document.getElementById('btn-admin-manage-users');
    this.adminManagementModal = document.getElementById('admin-management-modal');
    this.btnCloseAdminModal = document.getElementById('btn-close-admin-modal');
    this.createAdminForm = document.getElementById('create-admin-form');
    this.newAdminUsername = document.getElementById('new-admin-username');
    this.newAdminPassword = document.getElementById('new-admin-password');
    this.adminAccountsList = document.getElementById('admin-accounts-list');

    // Change Password DOM Elements
    this.btnAdminChangePassword = document.getElementById('btn-admin-change-password');
    this.adminChangePasswordModal = document.getElementById('admin-change-password-modal');
    this.btnClosePwdModal = document.getElementById('btn-close-pwd-modal');
    this.btnCancelPwd = document.getElementById('btn-cancel-pwd');
    this.changePwdForm = document.getElementById('change-pwd-form');
    this.inputOldPassword = document.getElementById('input-old-password');
    this.inputNewPassword = document.getElementById('input-new-password');
    this.inputConfirmPassword = document.getElementById('input-confirm-password');
    this.changePwdMsg = document.getElementById('change-pwd-msg');

    this.bindEvents();
  }

  bindEvents() {
    if (this.btnAdminManageUsers) {
      this.btnAdminManageUsers.addEventListener('click', () => {
        if (this.adminManagementModal) {
          this.adminManagementModal.classList.remove('hidden');
          this.fetchAdminAccountsList();
        }
      });
    }

    if (this.btnCloseAdminModal) {
      this.btnCloseAdminModal.addEventListener('click', () => {
        if (this.adminManagementModal) this.adminManagementModal.classList.add('hidden');
      });
    }

    if (this.createAdminForm) {
      this.createAdminForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const username = this.newAdminUsername ? this.newAdminUsername.value.trim() : '';
        const password = this.newAdminPassword ? this.newAdminPassword.value.trim() : '';
        if (!username || !password) return alert('请填写完整的用户名和密码');

        const profile = window.ChatStorageManager.getProfile();
        const token = profile ? profile.adminToken : null;
        fetch(formatApiUrl('/api/admin/create'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ username, password })
        })
        .then(r => r.json())
        .then(res => {
          if (res.success) {
            alert(`🎉 成功创建客服管理员账号: ${username}`);
            if (this.newAdminUsername) this.newAdminUsername.value = '';
            if (this.newAdminPassword) this.newAdminPassword.value = '';
            this.fetchAdminAccountsList();
            this.fetchAdminList();
          } else {
            alert('创建失败: ' + res.message);
          }
        });
      });
    }

    // Change Password Modal Event Bindings
    if (this.btnAdminChangePassword) {
      this.btnAdminChangePassword.addEventListener('click', () => {
        if (this.currentAdminRole === 'super_admin') {
          alert('🔑 提示：超级主管理员账号与密码由根目录下的 config.json 配置文件统一管理，无法在此修改。');
          return;
        }
        if (this.adminChangePasswordModal) {
          if (this.inputOldPassword) this.inputOldPassword.value = '';
          if (this.inputNewPassword) this.inputNewPassword.value = '';
          if (this.inputConfirmPassword) this.inputConfirmPassword.value = '';
          if (this.changePwdMsg) this.changePwdMsg.style.display = 'none';
          this.adminChangePasswordModal.classList.remove('hidden');
        }
      });
    }

    const closePwdModal = () => {
      if (this.adminChangePasswordModal) this.adminChangePasswordModal.classList.add('hidden');
    };

    if (this.btnClosePwdModal) this.btnClosePwdModal.addEventListener('click', closePwdModal);
    if (this.btnCancelPwd) this.btnCancelPwd.addEventListener('click', closePwdModal);

    if (this.changePwdForm) {
      this.changePwdForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const oldPassword = this.inputOldPassword ? this.inputOldPassword.value.trim() : '';
        const newPassword = this.inputNewPassword ? this.inputNewPassword.value.trim() : '';
        const confirmPassword = this.inputConfirmPassword ? this.inputConfirmPassword.value.trim() : '';

        const showMsg = (msg, isSuccess = false) => {
          if (this.changePwdMsg) {
            this.changePwdMsg.style.display = 'block';
            this.changePwdMsg.style.background = isSuccess ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)';
            this.changePwdMsg.style.color = isSuccess ? '#4ade80' : '#f87171';
            this.changePwdMsg.style.border = isSuccess ? '1px solid #22c55e' : '1px solid #ef4444';
            this.changePwdMsg.textContent = msg;
          }
        };

        if (!oldPassword || !newPassword) {
          return showMsg('原密码与新密码不能为空');
        }
        if (newPassword.length < 4) {
          return showMsg('新密码长度不能少于 4 个字符');
        }
        if (newPassword !== confirmPassword) {
          return showMsg('两次输入的新密码不一致，请重新检查');
        }

        const profile = window.ChatStorageManager.getProfile();
        const token = profile ? profile.adminToken : null;
        fetch(formatApiUrl('/api/admin/change-password'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ oldPassword, newPassword })
        })
        .then(r => r.json())
        .then(res => {
          if (res.success) {
            showMsg('🎉 密码修改成功！下次登录请使用新密码。', true);
            setTimeout(() => {
              closePwdModal();
            }, 1600);
          } else {
            showMsg('修改失败: ' + res.message);
          }
        })
        .catch(err => {
          showMsg('网络请求异常: ' + err.message);
        });
      });
    }
  }

  initTeamView(adminUsername, adminRole) {
    this.currentAdminUsername = adminUsername;
    this.currentAdminRole = adminRole;

    if (this.adminRoleBadge) {
      if (this.currentAdminRole === 'super_admin') {
        this.adminRoleBadge.textContent = '客服主管';
        this.adminRoleBadge.classList.add('super');
      } else {
        this.adminRoleBadge.textContent = '客服专员';
        this.adminRoleBadge.classList.remove('super');
      }
    }

    if (this.btnAdminManageUsers) {
      if (this.currentAdminRole === 'super_admin') {
        this.btnAdminManageUsers.style.display = 'inline-flex';
      } else {
        this.btnAdminManageUsers.style.display = 'none';
      }
    }

    if (this.btnAdminChangePassword) {
      if (this.currentAdminRole === 'super_admin') {
        this.btnAdminChangePassword.title = '主管理密码由 config.json 配置';
      } else {
        this.btnAdminChangePassword.title = '修改我的管理员密码';
      }
    }
  }

  setAvailableAdmins(adminList) {
    this.availableAdminsList = adminList || [];
    this.renderTeamList();
  }

  renderTeamList() {
    if (!this.adminTeamList) return;
    this.adminTeamList.innerHTML = '';
    const filterText = (this.adminUserSearch ? this.adminUserSearch.value : '').trim().toLowerCase();

    const hallDiv = document.createElement('div');
    const isHallSel = this.adminInternalTarget === 'ALL';
    hallDiv.className = `user-item ${isHallSel ? 'active' : ''}`;
    hallDiv.innerHTML = `
      <div class="user-avatar" style="background: linear-gradient(135deg, #8b5cf6, #ec4899);">📢</div>
      <div class="user-info">
        <div class="user-header">
          <span class="user-name">团队内部大厅 (全员频道)</span>
          <span class="admin-internal-tag">内部</span>
        </div>
        <div class="user-reason">管理员团队公共内部群聊</div>
      </div>
    `;
    hallDiv.addEventListener('click', () => this.selectAdminInternalTarget('ALL'));
    
    if (!filterText || '团队内部大厅 全员频道 公共群聊'.includes(filterText)) {
      this.adminTeamList.appendChild(hallDiv);
    }

    this.availableAdminsList.forEach(adm => {
      if (adm.username === this.currentAdminUsername) return;
      const displayName = adm.displayName || adm.username;
      if (filterText && !displayName.toLowerCase().includes(filterText) && !adm.username.toLowerCase().includes(filterText) && !(adm.role || '').toLowerCase().includes(filterText)) {
        return;
      }
      const isSel = this.adminInternalTarget === adm.username;
      const admDiv = document.createElement('div');
      admDiv.className = `user-item ${isSel ? 'active' : ''}`;
      const isSuper = adm.role === 'super_admin';
      admDiv.innerHTML = `
        <img src="${this.createAvatarSvg(displayName, adm.role)}" class="user-avatar-img" style="margin-right: 8px;" />
        <div class="user-info">
          <div class="user-header">
            <span class="user-name">${this.escapeHTML(displayName)}</span>
            <span class="status-dot ${adm.online ? 'online' : ''}"></span>
          </div>
          <div class="user-reason">${isSuper ? '客服主管' : '客服专员'} (${adm.online ? '在线' : '离线'})</div>
        </div>
      `;
      admDiv.addEventListener('click', () => this.selectAdminInternalTarget(adm.username));
      this.adminTeamList.appendChild(admDiv);
    });
  }

  selectAdminInternalTarget(targetUsername) {
    this.adminInternalTarget = targetUsername;
    this.renderTeamList();

    if (this.adminView) this.adminView.classList.add('mobile-show-chat');

    if (targetUsername === 'ALL') {
      this.adminTargetNickname.innerHTML = `📢 团队内部大厅 <span class="admin-internal-tag">内部全员</span>`;
      this.adminTargetStatus.textContent = '管理员团队全员实时公共频道';
      this.adminTargetAvatar.textContent = '📢';
      this.adminTargetAvatar.style.background = 'linear-gradient(135deg, #8b5cf6, #ec4899)';
    } else {
      this.adminTargetNickname.innerHTML = `👥 内部私聊: ${this.escapeHTML(targetUsername)} <span class="admin-internal-tag">专属沟通</span>`;
      const admObj = this.availableAdminsList.find(a => a.username === targetUsername);
      const isOnline = admObj ? admObj.online : false;
      this.adminTargetStatus.textContent = `管理员内部私聊 (${isOnline ? '🟢 在线' : '⚪ 离线'})`;
      this.adminTargetAvatar.textContent = '👥';
      this.adminTargetAvatar.style.background = 'linear-gradient(135deg, var(--primary), var(--accent-cyan))';
    }

    if (this.adminTargetReasonBar) this.adminTargetReasonBar.style.display = 'none';
    if (this.btnClearTargetChat) this.btnClearTargetChat.style.display = 'none';

    if (this.adminInput) this.adminInput.disabled = false;
    if (this.btnAdminSend) this.btnAdminSend.disabled = false;
    if (this.btnAdminImage) this.btnAdminImage.disabled = false;
    if (this.btnAdminFile) this.btnAdminFile.disabled = false;

    this.renderInternalChat();
  }

  renderInternalChat() {
    if (!this.adminMessagesContainer) return;
    this.adminMessagesContainer.innerHTML = '';

    const filtered = this.allAdminInternalMessages.filter(m => {
      if (this.adminInternalTarget === 'ALL') {
        return m.receiverUsername === 'ALL';
      } else {
        return (m.senderUsername === this.adminInternalTarget && m.receiverUsername === this.currentAdminUsername) ||
               (m.senderUsername === this.currentAdminUsername && m.receiverUsername === this.adminInternalTarget);
      }
    });

    if (filtered.length === 0) {
      this.adminMessagesContainer.innerHTML = `
        <div class="empty-placeholder">
          <div class="icon">👥</div>
          <p>暂无内部沟通记录，主动发一条消息吧！</p>
        </div>`;
      return;
    }

    filtered.forEach(m => {
      const isSelf = m.senderUsername === this.currentAdminUsername;
      const msgObj = {
        id: m.id,
        fromNickname: isSelf ? `${m.senderUsername} (我)` : m.senderUsername,
        text: m.text,
        timestamp: m.timestamp,
        senderRole: 'admin'
      };
      this.appendMessageBubble(msgObj, isSelf);
    });

    this.adminMessagesContainer.scrollTop = this.adminMessagesContainer.scrollHeight;
  }

  sendTeamMessage(text) {
    if (!text) return;
    const msgObj = {
      id: Date.now() + '-' + Math.random().toString(36).substr(2, 5),
      senderUsername: this.currentAdminUsername,
      receiverUsername: this.adminInternalTarget,
      text: text,
      timestamp: new Date().toISOString()
    };

    this.socket.emit('admin-internal-message', msgObj);
  }

  onNewInternalMessage(msgObj, isTeamTabActive) {
    if (!this.allAdminInternalMessages.some(m => m.id === msgObj.id)) {
      this.allAdminInternalMessages.push(msgObj);
    }

    if (isTeamTabActive) {
      this.renderInternalChat();
    } else {
      playNotificationSound();
      this.teamUnreadCount++;
      if (this.teamUnreadBadge) {
        this.teamUnreadBadge.textContent = this.teamUnreadCount;
        this.teamUnreadBadge.classList.remove('hidden');
      }
      sendDesktopNotification(`👥 来自管理员 ${msgObj.senderUsername} 的内部消息`, {
        body: msgObj.text,
        tag: 'internal-msg'
      });
    }
  }

  fetchAdminAccountsList() {
    const profile = window.ChatStorageManager.getProfile();
    const token = profile ? profile.adminToken : null;
    fetch(formatApiUrl('/api/admin/list'), {
      headers: { 'Authorization': `Bearer ${token}` }
    })
    .then(r => r.json())
    .then(res => {
      if (res && res.success && Array.isArray(res.admins)) {
        this.renderAdminAccountsList(res.admins);
      }
    })
    .catch(err => console.error('[FETCH ADMIN ACCOUNTS ERROR]', err));
  }

  fetchAdminList() {
    fetch(formatApiUrl('/api/admins'))
      .then(r => r.json())
      .then(res => {
        if (res && res.success && Array.isArray(res.adminList)) {
          this.setAvailableAdmins(res.adminList);
        }
      })
      .catch(err => console.error('[FETCH ADMINS ERROR]', err));
  }

  renderAdminAccountsList(admins) {
    if (!this.adminAccountsList) return;
    this.adminAccountsList.innerHTML = '';

    admins.forEach(adm => {
      const tr = document.createElement('tr');
      tr.className = 'admin-table-row';
      const isSuper = adm.role === 'super_admin';
      const currentName = adm.display_name || adm.username;

      tr.innerHTML = `
        <td style="padding: 10px 12px; font-weight: 600; color: var(--text-main); font-family: monospace;">
          <img src="${this.createAvatarSvg(currentName, adm.role)}" class="user-avatar-img sm" style="vertical-align: middle; margin-right: 6px;" />
          ${this.escapeHTML(adm.username)}
        </td>
        <td style="padding: 10px 12px;">
          <div style="display: flex; gap: 6px; align-items: center;">
            <input type="text" class="input-display-name" value="${this.escapeHTML(currentName)}" placeholder="输入显示名称" style="background: rgba(15, 23, 42, 0.6); border: 1px solid var(--glass-border); padding: 4px 8px; border-radius: var(--radius-sm); color: var(--text-main); font-size: 12px; width: 120px;">
            <button type="button" class="btn-icon btn-save-name" style="padding: 4px 8px; font-size: 11px;">💾 保存</button>
          </div>
        </td>
        <td style="padding: 10px 12px;">
          <span class="admin-badge ${isSuper ? 'super' : ''}">${isSuper ? '客服主管' : '客服专员'}</span>
        </td>
        <td style="padding: 10px 12px; text-align: right;">
          ${isSuper ? '<span style="font-size:11px; color:var(--text-dim);">不可删除</span>' : `<button type="button" class="btn-icon btn-danger btn-delete-admin" data-username="${this.escapeHTML(adm.username)}" style="padding: 4px 8px; font-size: 11px;">🗑️ 删除</button>`}
        </td>
      `;

      const btnSave = tr.querySelector('.btn-save-name');
      const inputName = tr.querySelector('.input-display-name');
      btnSave.addEventListener('click', () => {
        const newName = inputName.value.trim();
        const profile = window.ChatStorageManager.getProfile();
        const token = profile ? profile.adminToken : null;
        fetch(formatApiUrl('/api/admin/update-display-name'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ username: adm.username, displayName: newName })
        })
        .then(r => r.json())
        .then(res => {
          if (res.success) {
            alert(`已成功更新 ${adm.username} 的显示名称为 "${newName || adm.username}"`);
            this.fetchAdminAccountsList();
            this.fetchAdminList();
          } else {
            alert('更新显示名称失败: ' + res.message);
          }
        });
      });

      const btnDelete = tr.querySelector('.btn-delete-admin');
      if (btnDelete) {
        btnDelete.addEventListener('click', () => {
          if (confirm(`确定要删除管理员账号 (${adm.username}) 吗？`)) {
            const profile = window.ChatStorageManager.getProfile();
            const token = profile ? profile.adminToken : null;
            fetch(formatApiUrl('/api/admin/delete'), {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
              },
              body: JSON.stringify({ username: adm.username })
            })
            .then(r => r.json())
            .then(res => {
              if (res.success) {
                alert(res.message || '已成功删除该账号');
                this.fetchAdminAccountsList();
                this.fetchAdminList();
              } else {
                alert('删除失败: ' + res.message);
              }
            });
          }
        });
      }

      this.adminAccountsList.appendChild(tr);
    });
  }

  appendMessageBubble(msg, isSentByMe) {
    const timeStr = this.formatTime(msg.timestamp);
    const bubbleWrapper = document.createElement('div');
    bubbleWrapper.className = `message-bubble-wrapper ${isSentByMe ? 'sent' : 'received'}`;
    
    bubbleWrapper.innerHTML = `
      <div class="message-meta">
        <span>${this.escapeHTML(msg.fromNickname || '管理员')}</span>
        <span>•</span>
        <span>${timeStr}</span>
      </div>
      <div class="message-bubble">${this.escapeHTML(msg.text)}</div>
    `;

    this.adminMessagesContainer.appendChild(bubbleWrapper);
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
