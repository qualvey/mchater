/**
 * Browser System Notification & Web Audio Sound Manager
 */

export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(permission => {
      console.log('[NOTIFICATION] Permission state:', permission);
    });
  }
}

export function playNotificationSound() {
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

export function sendDesktopNotification(title, options = {}, onClickCallback = null) {
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
