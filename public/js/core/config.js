/**
 * Core Configuration & Base Path Helper
 * Normalizes API endpoints and Socket.IO paths for proxy/subpath deployments
 */

export const getRawBase = () => {
  if (typeof window.MYCHAT_BASE_PATH !== 'undefined') return window.MYCHAT_BASE_PATH;
  const path = window.location.pathname;
  return path.replace(/\/index\.html$/, '').replace(/\/$/, '');
};

export const API_BASE = getRawBase().replace(/\/$/, '');

export const formatApiUrl = (endpoint) => {
  if (!endpoint) return '';
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://') || endpoint.startsWith('data:')) return endpoint;
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
  return `${API_BASE}${cleanEndpoint}`;
};
