// mock/ai-usage-server.mjs — stand-in for the (not-yet-built) ai-usage-monitor.
// Implements the specified contract on :3456 so the ai-usage widget is demoable
// today: GET /usage, /usage/:provider, /health, and an SSE /events stream.
import http from 'node:http';

const PORT = Number(process.env.PORT || 3456);

// Mutable fake state that drifts upward over time.
const state = {
  claude: { spendUSD: 4.12, tokensIn: 182000, tokensOut: 44100, requests: 73 },
  openrouter: { spendUSD: 1.07, tokensIn: 90100, tokensOut: 12800, requests: 31 },
};

function snapshot() {
  const providers = Object.entries(state).map(([provider, v]) => ({
    provider,
    spendUSD: Math.round(v.spendUSD * 100) / 100,
    tokensIn: v.tokensIn,
    tokensOut: v.tokensOut,
    requests: v.requests,
    window: 'today',
  }));
  const totalSpendUSD =
    Math.round(providers.reduce((s, p) => s + p.spendUSD, 0) * 100) / 100;
  return { providers, totalSpendUSD, ts: Date.now() };
}

function drift() {
  for (const v of Object.values(state)) {
    v.spendUSD += Math.round(Math.random() * 5) / 100;
    v.tokensIn += Math.floor(Math.random() * 800);
    v.tokensOut += Math.floor(Math.random() * 200);
    v.requests += Math.random() < 0.4 ? 1 : 0;
  }
}

const sseClients = new Set();

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (obj, status = 200) => {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify(obj));
  };

  if (url.pathname === '/health') return json({ ok: true, ts: Date.now() });
  if (url.pathname === '/usage') return json(snapshot());
  if (url.pathname.startsWith('/usage/')) {
    const name = url.pathname.split('/')[2];
    const p = snapshot().providers.find((x) => x.provider === name);
    return p ? json(p) : json({ error: 'unknown provider' }, 404);
  }
  if (url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return undefined;
  }
  json({ error: 'not found' }, 404);
});

setInterval(() => {
  drift();
  const data = `event: usage\ndata: ${JSON.stringify(snapshot())}\n\n`;
  for (const c of sseClients) {
    try {
      c.write(data);
    } catch {
      sseClients.delete(c);
    }
  }
}, 3000).unref?.();

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[mock ai-usage] listening on http://127.0.0.1:${PORT}`);
});
