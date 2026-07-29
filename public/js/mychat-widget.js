/**
 * MyChat Commercial Embeddable Widget SDK (mychat-widget.js)
 * Allows 3rd-party websites to embed the MyChat customer support system with 1 line of script.
 * 
 * Usage:
 * <script src="http://your-domain.com/js/mychat-widget.js" data-server="http://your-domain.com" data-position="bottom-right" data-theme="violet"></script>
 */
(function () {
  if (window.MyChatWidget) return;

  const currentScript = document.currentScript || (function () {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  const defaultConfig = {
    server: (currentScript && currentScript.getAttribute('data-server')) || window.location.origin,
    position: (currentScript && currentScript.getAttribute('data-position')) || 'bottom-right', // 'bottom-right' | 'bottom-left'
    title: (currentScript && currentScript.getAttribute('data-title')) || '在线客服求助',
    bubbleIcon: '💬',
    zIndex: 999999
  };

  class MyChatWidgetSDK {
    constructor(config = {}) {
      this.config = { ...defaultConfig, ...config };
      this.isOpen = false;
      this.init();
    }

    init() {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => this.render());
      } else {
        this.render();
      }
    }

    render() {
      if (document.getElementById('mychat-widget-container')) return;

      const style = document.createElement('style');
      style.id = 'mychat-widget-styles';
      style.textContent = `
        #mychat-widget-container {
          position: fixed;
          bottom: 24px;
          ${this.config.position === 'bottom-left' ? 'left: 24px;' : 'right: 24px;'}
          z-index: ${this.config.zIndex};
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        }

        .mychat-widget-bubble {
          width: 58px;
          height: 58px;
          border-radius: 50%;
          background: linear-gradient(135deg, #6366f1, #3b82f6);
          box-shadow: 0 8px 24px rgba(99, 102, 241, 0.45);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 26px;
          color: #ffffff;
          cursor: pointer;
          transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
          border: 2px solid rgba(255, 255, 255, 0.3);
          user-select: none;
        }

        .mychat-widget-bubble:hover {
          transform: scale(1.1) translateY(-3px);
          box-shadow: 0 12px 30px rgba(99, 102, 241, 0.6);
        }

        .mychat-widget-bubble:active {
          transform: scale(0.95);
        }

        .mychat-widget-badge {
          position: absolute;
          top: -2px;
          right: -2px;
          width: 14px;
          height: 14px;
          background: #10b981;
          border: 2px solid #ffffff;
          border-radius: 50%;
        }

        .mychat-widget-iframe-container {
          position: fixed;
          bottom: 94px;
          ${this.config.position === 'bottom-left' ? 'left: 24px;' : 'right: 24px;'}
          width: 400px;
          height: 620px;
          max-width: calc(100vw - 32px);
          max-height: calc(100vh - 120px);
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
          opacity: 0;
          visibility: hidden;
          transform: translateY(20px) scale(0.95);
          transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
          z-index: ${this.config.zIndex};
          border: 1px solid rgba(255, 255, 255, 0.15);
          background: #0f172a;
        }

        .mychat-widget-iframe-container.open {
          opacity: 1;
          visibility: visible;
          transform: translateY(0) scale(1);
        }

        .mychat-widget-iframe {
          width: 100%;
          height: 100%;
          border: none;
        }

        @media (max-width: 480px) {
          .mychat-widget-iframe-container {
            bottom: 0 !important;
            left: 0 !important;
            right: 0 !important;
            width: 100vw !important;
            height: 100dvh !important;
            max-width: 100vw !important;
            max-height: 100dvh !important;
            border-radius: 0 !important;
          }
        }
      `;
      document.head.appendChild(style);

      const container = document.createElement('div');
      container.id = 'mychat-widget-container';

      const bubble = document.createElement('div');
      bubble.className = 'mychat-widget-bubble';
      bubble.title = this.config.title;
      bubble.innerHTML = `${this.config.bubbleIcon}<span class="mychat-widget-badge"></span>`;
      bubble.addEventListener('click', () => this.toggle());

      const iframeBox = document.createElement('div');
      iframeBox.className = 'mychat-widget-iframe-container';
      iframeBox.id = 'mychat-widget-iframe-box';

      const cleanServer = this.config.server.replace(/\/$/, '');
      const iframe = document.createElement('iframe');
      iframe.className = 'mychat-widget-iframe';
      iframe.src = `${cleanServer}/index.html`;

      iframeBox.appendChild(iframe);
      container.appendChild(bubble);
      document.body.appendChild(container);
      document.body.appendChild(iframeBox);

      this.bubbleEl = bubble;
      this.iframeBoxEl = iframeBox;
    }

    open() {
      if (this.iframeBoxEl) {
        this.iframeBoxEl.classList.add('open');
        this.isOpen = true;
        if (this.bubbleEl) this.bubbleEl.innerHTML = '✕';
      }
    }

    close() {
      if (this.iframeBoxEl) {
        this.iframeBoxEl.classList.remove('open');
        this.isOpen = false;
        if (this.bubbleEl) this.bubbleEl.innerHTML = `${this.config.bubbleIcon}<span class="mychat-widget-badge"></span>`;
      }
    }

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }
  }

  window.MyChatWidget = new MyChatWidgetSDK();
})();
