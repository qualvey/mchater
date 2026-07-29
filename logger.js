/**
 * Configurable Logger Utility (logger.js)
 * Supports log levels: debug, info, warn, error, none
 * Configured via config.json under "log": { "level": "debug" }
 */
class Logger {
  static levels = { debug: 0, info: 1, warn: 2, error: 3, none: 4 };
  static currentLevel = 'info';

  static setLevel(level) {
    if (level && typeof level === 'string' && level.toLowerCase() in this.levels) {
      this.currentLevel = level.toLowerCase();
    }
  }

  static getLevel() {
    return this.currentLevel;
  }

  static shouldLog(targetLevel) {
    const currentPriority = this.levels[this.currentLevel] ?? 1;
    const targetPriority = this.levels[targetLevel] ?? 1;
    return targetPriority >= currentPriority;
  }

  static formatTag(tag) {
    const time = new Date().toISOString();
    return `[${time}] [${tag}]`;
  }

  static debug(tag, ...args) {
    if (this.shouldLog('debug')) {
      console.log(`[DEBUG] ${this.formatTag(tag)}`, ...args);
    }
  }

  static info(tag, ...args) {
    if (this.shouldLog('info')) {
      console.log(`[INFO] ${this.formatTag(tag)}`, ...args);
    }
  }

  static warn(tag, ...args) {
    if (this.shouldLog('warn')) {
      console.warn(`[WARN] ${this.formatTag(tag)}`, ...args);
    }
  }

  static error(tag, ...args) {
    if (this.shouldLog('error')) {
      console.error(`[ERROR] ${this.formatTag(tag)}`, ...args);
    }
  }
}

module.exports = Logger;
