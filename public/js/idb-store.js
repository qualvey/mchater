/**
 * IDBFileStore - IndexedDB File Persistence Manager
 * Persists pending upload files across browser reloads & offline cycles.
 */
class IDBFileStore {
  static DB_NAME = 'MyChatFileDB';
  static DB_VERSION = 1;
  static STORE_NAME = 'pending_files';

  static openDB() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        return reject(new Error('IndexedDB is not supported in this browser'));
      }
      const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(this.STORE_NAME)) {
          db.createObjectStore(this.STORE_NAME);
        }
      };

      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  static async saveFile(msgId, file) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.put(file, msgId);
        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.error('[IDB SAVE FILE ERROR]', err);
      return false;
    }
  }

  static async getFile(msgId) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readonly');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.get(msgId);
        req.onsuccess = (e) => resolve(e.target.result || null);
        req.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.error('[IDB GET FILE ERROR]', err);
      return null;
    }
  }

  static async deleteFile(msgId) {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(this.STORE_NAME, 'readwrite');
        const store = tx.objectStore(this.STORE_NAME);
        const req = store.delete(msgId);
        req.onsuccess = () => resolve(true);
        req.onerror = (e) => reject(e.target.error);
      });
    } catch (err) {
      console.error('[IDB DELETE FILE ERROR]', err);
      return false;
    }
  }
}

window.IDBFileStore = IDBFileStore;
