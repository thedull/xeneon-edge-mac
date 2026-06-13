// AI-usage collector: proxies the (planned) ai-usage-monitor daemon on :3456 and
// normalizes its /usage payload. Until that project exists, run `npm run mock:ai`.
import { USE_FIXTURES, fixtureJson, now } from './_exec.mjs';

const MONITOR_BASE = process.env.XEM_AI_USAGE_URL || 'http://127.0.0.1:3456';

// Normalize the monitor's /usage shape into our contract. Defensive about field
// names since the real monitor isn't built yet (only specified).
export function normalizeUsage(payload) {
  const providersRaw = Array.isArray(payload?.providers)
    ? payload.providers
    : Array.isArray(payload)
      ? payload
      : [];
  const providers = providersRaw.map((p) => ({
    provider: p.provider ?? p.name ?? 'unknown',
    spendUSD: num(p.spendUSD ?? p.spend ?? p.costUSD ?? p.cost),
    tokensIn: num(p.tokensIn ?? p.inputTokens ?? p.promptTokens),
    tokensOut: num(p.tokensOut ?? p.outputTokens ?? p.completionTokens),
    requests: num(p.requests ?? p.requestCount ?? p.count),
    window: p.window ?? p.period ?? 'today',
  }));
  const totalSpendUSD =
    num(payload?.totalSpendUSD) ||
    Math.round(providers.reduce((s, p) => s + p.spendUSD, 0) * 100) / 100;
  return { available: true, providers, totalSpendUSD };
}

function num(v) {
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}

export async function collect() {
  if (USE_FIXTURES) {
    const snap = await fixtureJson('ai-usage.json');
    return { ...snap, source: 'ai-usage-monitor', ts: now() };
  }
  try {
    const res = await fetch(`${MONITOR_BASE}/usage`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = await res.json();
    return { ...normalizeUsage(payload), source: 'ai-usage-monitor', ts: now() };
  } catch (err) {
    return {
      available: false,
      reason: `ai-usage-monitor unreachable on ${MONITOR_BASE} (${err.message})`,
      providers: [],
      totalSpendUSD: 0,
      source: 'ai-usage-monitor',
      ts: now(),
    };
  }
}

export { MONITOR_BASE };
