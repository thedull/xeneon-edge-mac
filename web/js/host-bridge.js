// host-bridge.js — the single indirection that makes widgets host-agnostic.
// Resolves the API origin from ?api= → window.__HOST_API_BASE__ → location.origin,
// and provides fetch/post helpers + an SSE subscription with polling fallback.

const params = new URLSearchParams(location.search);

function resolveApiBase() {
  const q = params.get('api');
  if (q) return q.replace(/\/$/, '');
  if (typeof window !== 'undefined' && window.__HOST_API_BASE__) {
    return String(window.__HOST_API_BASE__).replace(/\/$/, '');
  }
  return location.origin;
}

export const apiBase = resolveApiBase();

export function apiUrl(pathname) {
  return apiBase + pathname;
}

export async function fetchJson(pathname, opts) {
  const res = await fetch(apiBase + pathname, opts);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${pathname}`);
  return res.json();
}

export function postJson(pathname, body) {
  return fetchJson(pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
}

// Subscribe to named server events. Uses SSE when available, falls back to
// polling the matching GET endpoint if the stream errors or never opens.
const POLL_ENDPOINTS = {
  system: '/api/system',
  network: '/api/network',
  media: '/api/media',
  'ai-usage': '/api/ai-usage',
};

export function connectEvents(handlers = {}, { pollMs = 2000, openTimeoutMs = 1500 } = {}) {
  let es = null;
  let closed = false;
  let pollers = [];

  function startPolling() {
    if (pollers.length) return;
    for (const [ev, handler] of Object.entries(handlers)) {
      const endpoint = POLL_ENDPOINTS[ev];
      if (!endpoint) continue;
      const tick = async () => {
        try {
          handler(await fetchJson(endpoint));
        } catch {
          /* keep trying */
        }
      };
      tick();
      pollers.push(setInterval(tick, pollMs));
    }
  }

  function stopPolling() {
    pollers.forEach(clearInterval);
    pollers = [];
  }

  function connect() {
    try {
      es = new EventSource(apiBase + '/events');
      es.onopen = () => stopPolling();
      es.onerror = () => {
        if (!closed) startPolling();
      };
      for (const [ev, handler] of Object.entries(handlers)) {
        es.addEventListener(ev, (e) => {
          try {
            handler(JSON.parse(e.data));
          } catch {
            /* ignore malformed frame */
          }
        });
      }
    } catch {
      startPolling();
    }
  }

  connect();
  // If SSE hasn't opened shortly, begin polling so the UI is never empty.
  setTimeout(() => {
    if (!es || es.readyState !== 1) startPolling();
  }, openTimeoutMs);

  return {
    close() {
      closed = true;
      stopPolling();
      try {
        es && es.close();
      } catch {
        /* ignore */
      }
    },
  };
}
