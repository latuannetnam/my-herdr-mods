import { clampRemaining, getQuotaLevel } from "../helpers.js";

export const CODEX_RPC_SCRIPT = [
  "const { spawn, spawnSync } = require('node:child_process');",
  "const isWin = process.platform === 'win32';",
  "const p = spawn(isWin ? 'cmd.exe' : 'sh', isWin ? ['/d', '/s', '/c', 'codex app-server'] : ['-lc', 'codex app-server'], { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });",
  "let done = false;",
  "const cleanup = (code) => { if (done) return; done = true; clearTimeout(timer); try { p.stdin.end(); } catch {} if (code !== 0 && isWin && p.pid) { try { spawnSync('taskkill', ['/PID', String(p.pid), '/T', '/F'], { windowsHide: true }); } catch {} } try { p.kill(); } catch {} process.exit(code); };",
  "const timer = setTimeout(() => cleanup(1), 12000);",
  "p.on('error', () => cleanup(1));",
  "p.stdin.on('error', () => {});",
  "let buf = '';",
  "p.stdout.setEncoding('utf8');",
  "p.stdout.on('data', chunk => {",
  "  buf += chunk;",
  "  const lines = buf.split(/\\r?\\n/);",
  "  buf = lines.pop() || '';",
  "  for (const line of lines) {",
  "    if (!line.trim()) continue;",
  "    let msg;",
  "    try { msg = JSON.parse(line); } catch { continue; }",
  "    if (msg.id === 1) {",
  "      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} }) + '\\n');",
  "      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: null }) + '\\n');",
  "    } else if (msg.id === 2) {",
  "      process.stdout.write(JSON.stringify(msg) + '\\n', () => cleanup(0));",
  "    }",
  "  }",
  "});",
  "p.on('exit', () => cleanup(1));",
  "p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'herdr-agent-quota', version: '0.1.0' }, capabilities: {} } }) + '\\n');"
].join(" ");

function describeWindow(mins) {
  if (mins === 300) return { window: "5h", name: "Five Hour Limit Remaining" };
  if (mins === 10080) return { window: "weekly", name: "Weekly Limit Remaining" };
  if (typeof mins === "number" && mins > 0) {
    if (mins % 1440 === 0) return { window: "other", name: `${mins / 1440}d Limit Remaining` };
    return { window: "other", name: `${Math.max(1, Math.round(mins / 60))}h Limit Remaining` };
  }
  return { window: "other", name: "Limit Remaining" };
}

function findRpcMessage(rawOutput) {
  const lines = rawOutput.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const obj = JSON.parse(lines[i]);
      if (obj && typeof obj === "object" && (obj.error || obj.result || obj.rateLimits || obj.rateLimitsByLimitId)) {
        return obj;
      }
    } catch {
      // Ignore non-JSON lines
    }
  }
  return null;
}

export function parseCodexQuota(rawOutput, nowMs = Date.now()) {
  if (!rawOutput || typeof rawOutput !== "string") return null;
  const envelope = findRpcMessage(rawOutput);
  if (!envelope || envelope.error) return null;

  const res = envelope.result || envelope;
  const byId = res?.rateLimitsByLimitId && typeof res.rateLimitsByLimitId === "object" && Object.keys(res.rateLimitsByLimitId).length > 0
    ? res.rateLimitsByLimitId
    : (res?.rateLimits ? { [res.rateLimits.limitId || "codex"]: res.rateLimits } : null);

  if (!byId) return null;

  let lowestFraction = 1.0;
  let totalBuckets = 0;

  const groups = Object.entries(byId).map(([limitId, lim]) => {
    if (!lim || typeof lim !== "object") return null;
    const rawWindows = [
      lim.primary ? { id: `${limitId}-primary`, raw: lim.primary } : null,
      lim.secondary ? { id: `${limitId}-secondary`, raw: lim.secondary } : null
    ].filter(Boolean);

    const buckets = rawWindows.map(({ id, raw }) => {
      const used = Number(raw.usedPercent);
      if (Number.isNaN(used)) return null;
      const fraction = clampRemaining((100 - used) / 100);
      totalBuckets += 1;
      if (fraction < lowestFraction) lowestFraction = fraction;

      const percentage = Math.round(fraction * 100);
      const meta = describeWindow(raw.windowDurationMins);
      const resetTime = typeof raw.resetsAt === "number" && raw.resetsAt > 0
        ? new Date(raw.resetsAt * 1000).toISOString()
        : null;

      return {
        id,
        name: meta.name,
        window: meta.window,
        fraction,
        percentage,
        resetTime,
        level: getQuotaLevel(fraction)
      };
    }).filter(Boolean);

    if (buckets.length === 0) return null;

    return {
      id: limitId,
      name: limitId === "codex" ? "Codex Rate Limits" : `Codex (${limitId})`,
      subtitle: lim.planType ? `${String(lim.planType).toUpperCase()} Plan` : "",
      buckets
    };
  }).filter(Boolean);

  if (totalBuckets === 0 || groups.length === 0) return null;

  groups.sort((a, b) => (a.id === "codex" ? -1 : b.id === "codex" ? 1 : 0));

  const mainLim = byId.codex || res.rateLimits || Object.values(byId)[0];
  if (res.ordinaryUsageAllowed === false || mainLim?.spendControlReached === true) {
    lowestFraction = 0;
  }

  const badges = [];
  if (mainLim?.planType) {
    badges.push(String(mainLim.planType).toUpperCase());
  }
  const resets = Number(res?.rateLimitResetCredits?.availableCount || 0);
  if (resets > 0) {
    badges.push(`${resets} reset${resets === 1 ? "" : "s"}`);
  }
  if (mainLim?.credits?.unlimited) {
    badges.push("Unlimited credits");
  } else if (mainLim?.credits?.hasCredits && mainLim.credits.balance && mainLim.credits.balance !== "0") {
    badges.push(`$${mainLim.credits.balance} credits`);
  }
  if (res.ordinaryUsageAllowed === false || mainLim?.spendControlReached === true) {
    badges.push("LIMIT REACHED");
  }

  const primaryGroup = groups.find(g => g.id === "codex") || groups[0];
  const b5h = primaryGroup.buckets.find(b => b.window === "5h");
  const bwk = primaryGroup.buckets.find(b => b.window === "weekly");
  let pillText = "Codex";
  if (b5h && bwk) {
    pillText = `Codex ${b5h.percentage}/${bwk.percentage}%`;
  } else if (primaryGroup.buckets.length === 1) {
    pillText = `Codex ${primaryGroup.buckets[0].percentage}%`;
  } else if (primaryGroup.buckets.length > 1) {
    pillText = `Codex ${primaryGroup.buckets.map(b => b.percentage).join("/")}%`;
  }

  return {
    updatedAt: nowMs,
    lowestFraction,
    level: getQuotaLevel(lowestFraction),
    pillText,
    badges,
    groups
  };
}

export const codexProvider = {
  id: "codex",
  name: "Codex",
  shortLabel: "Codex",
  fetchRaw: exec => exec("node", ["-e", CODEX_RPC_SCRIPT], { timeout: 15000 }),
  parse: parseCodexQuota
};
