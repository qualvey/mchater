/**
 * Public REST API Routes (routes/public.routes.js)
 * Endpoints for file upload and public support agent listings.
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const ChatDatabase = require('../db');
const Logger = require('../logger');

function createPublicRouter({ isUploadRateLimited, activeUsers, sendToAllAdmins, getAdminListWithStatus, io }) {
  const router = express.Router();

  const ALLOWED_EXTENSIONS = new Set([
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'csv',
    'zip', 'rar', '7z', 'tar', 'gz', 'png', 'jpg', 'jpeg', 'gif', 'webp'
  ]);
  const DANGEROUS_EXTENSIONS = new Set([
    'exe', 'bat', 'cmd', 'sh', 'php', 'asp', 'aspx', 'jsp', 'js', 'html', 'htm', 'vbs', 'ps1', 'cgi', 'pl', 'py'
  ]);

  // HTTP Upload Endpoint
  router.post('/upload', (req, res) => {
    try {
      const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      if (isUploadRateLimited(clientIP)) {
        Logger.warn('UPLOAD_RATE_LIMITED', `Upload rate limit exceeded for IP: ${clientIP}`);
        return res.status(429).json({ success: false, message: '上传频次过高，请 1 分钟后再试' });
      }

      const { fileName, fileDataUrl, msgId, targetClientId } = req.body;
      if (!fileName || !fileDataUrl) {
        Logger.warn('UPLOAD_INVALID', `Missing filename or fileDataUrl from IP: ${clientIP}`);
        return res.status(400).json({ success: false, message: '文件数据缺失' });
      }

      const ext = (fileName || '').split('.').pop().toLowerCase();
      if (DANGEROUS_EXTENSIONS.has(ext) || !ALLOWED_EXTENSIONS.has(ext)) {
        Logger.warn('UPLOAD_SECURITY_BLOCK', `Blocked dangerous file extension .${ext} from IP: ${clientIP}, File: '${fileName}'`);
        return res.status(400).json({ success: false, message: '安全阻断：禁止上传可执行脚本或危险类型文件 (.' + ext + ')' });
      }

      const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const matches = fileDataUrl.match(/^data:(.+);base64,(.+)$/);
      let buffer;
      if (matches && matches[2]) {
        buffer = Buffer.from(matches[2], 'base64');
      } else {
        buffer = Buffer.from(fileDataUrl);
      }

      const safeFileName = `${Date.now()}_${path.basename(fileName).replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
      const filePath = path.join(uploadsDir, safeFileName);
      fs.writeFileSync(filePath, buffer);

      const fileUrl = `/uploads/${safeFileName}`;
      Logger.info('UPLOAD_SUCCESS', `Saved file '${safeFileName}' (${buffer.length} bytes) to ${fileUrl} for ClientID: ${targetClientId || 'Unknown'} from IP: ${clientIP}`);

      if (msgId && targetClientId) {
        const dbMsg = ChatDatabase.getMessageById(msgId);
        if (dbMsg) {
          let fileData = {};
          try {
            fileData = JSON.parse(dbMsg.text);
          } catch (e) { }

          fileData.fileStatus = 'completed';
          fileData.fileUrl = fileUrl;

          const updatedText = JSON.stringify(fileData);
          ChatDatabase.updateMessageText(msgId, updatedText);

          const payload = {
            msgId,
            targetClientId,
            fileUrl,
            fileData
          };

          const targetUser = activeUsers.get(targetClientId);
          if (targetUser && targetUser.sockets) {
            targetUser.sockets.forEach(sId => {
              io.to(sId).emit('file-upload-finished', payload);
            });
          }

          sendToAllAdmins('file-upload-finished', payload);
        }
      }

      return res.json({ success: true, fileUrl });
    } catch (err) {
      Logger.error('UPLOAD_ERROR', `Exception saving upload:`, err);
      return res.status(500).json({ success: false, message: '保存文件失败: ' + err.message });
    }
  });

  // REST API: Public Get Available Admins (for user support selector)
  router.get('/admins', (req, res) => {
    try {
      const adminList = getAdminListWithStatus();
      Logger.debug('PUBLIC_ADMINS_FETCH', `Fetched ${adminList.length} public admin profiles`);
      res.json({ success: true, adminList });
    } catch (err) {
      Logger.error('PUBLIC_ADMINS_ERROR', err);
      res.status(500).json({ success: false, message: err.message });
    }
  });

  return router;
}

module.exports = createPublicRouter;
