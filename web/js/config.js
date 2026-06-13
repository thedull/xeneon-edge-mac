// config.js — per-widget config via query params (override) + localStorage (persisted).
const params = new URLSearchParams(location.search);
const NS = 'xem.';

export function getConfig(key, fallback = null) {
  const q = params.get(key);
  if (q !== null) return q;
  const v = localStorage.getItem(NS + key);
  return v !== null ? v : fallback;
}

export function setConfig(key, value) {
  localStorage.setItem(NS + key, String(value));
}

export function clearConfig(key) {
  localStorage.removeItem(NS + key);
}
