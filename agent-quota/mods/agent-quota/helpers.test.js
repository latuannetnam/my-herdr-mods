import test from "node:test";
import assert from "node:assert/strict";
import {
  clampRemaining,
  getQuotaLevel,
  formatCountdown,
  mergeProviderResult,
  resolveActiveTab
} from "./helpers.js";
import { parseAgyQuota, agyProvider } from "./providers/agy.js";
import { parseCodexQuota, codexProvider, CODEX_RPC_SCRIPT } from "./providers/codex.js";
import { PROVIDERS } from "./providers/index.js";

test("clampRemaining, getQuotaLevel, formatCountdown, and resolveActiveTab", () => {
  assert.equal(clampRemaining(1.4), 1);
  assert.equal(clampRemaining(-0.2), 0);
  assert.equal(clampRemaining(NaN), 0);
  assert.equal(getQuotaLevel(0.51), "good");
  assert.equal(getQuotaLevel(0.5), "warn");
  assert.equal(getQuotaLevel(0.2), "warn");
  assert.equal(getQuotaLevel(0.19), "low");

  const now = Date.parse("2026-11-11T00:00:00Z");
  assert.equal(formatCountdown("2026-11-11T04:30:00Z", now), "4h 30m");
  assert.equal(formatCountdown("2026-11-10T23:59:00Z", now), "Ready");

  assert.equal(resolveActiveTab("codex", PROVIDERS), "codex");
  assert.equal(resolveActiveTab("agy", PROVIDERS), "agy");
  assert.equal(resolveActiveTab("unknown", PROVIDERS), "all");
  assert.equal(resolveActiveTab(undefined, PROVIDERS), "all");
});

test("parseAgyQuota builds compact AGY pillText and collapses 100/100%", () => {
  const now = 1794355000000;
  const raw = JSON.stringify({
    command: {
      data: {
        groups: [
          {
            name: "Gemini Models",
            description: "Models: Gemini 3.1 Pro, Flash",
            buckets: [
              { id: "gemini-5h", name: "Five Hour Limit Remaining", window: "5h", remaining_fraction: 0.97, reset_time: "2026-11-11T05:00:00Z" },
              { id: "gemini-weekly", name: "Weekly Limit Remaining", window: "weekly", remaining_fraction: 0.61, reset_time: "2026-11-15T00:00:00Z" }
            ]
          },
          {
            name: "Claude and GPT models",
            description: "Models: Claude Sonnet 4.6",
            buckets: [
              { id: "3p-5h", name: "Five Hour Limit Remaining", window: "5h", remaining_fraction: 1, reset_time: "2026-11-11T05:00:00Z" },
              { id: "3p-weekly", name: "Weekly Limit Remaining", window: "weekly", remaining_fraction: 1, reset_time: "2026-11-15T00:00:00Z" }
            ]
          }
        ]
      }
    }
  });

  const snap = parseAgyQuota(raw, now);
  assert.ok(snap);
  assert.equal(snap.pillText, "AGY G:97/61% · 3P:100%");
  assert.equal(snap.lowestFraction, 0.61);
  assert.equal(snap.level, "good");
  assert.equal(snap.groups[0].subtitle, "Gemini 3.1 Pro, Flash");
  assert.equal(parseAgyQuota("not-json", now), null);
});

test("parseCodexQuota converts usedPercent to remaining %, epoch seconds to ISO, and extracts badges", () => {
  const now = 1794355000000;
  const raw = [
    "{\"jsonrpc\":\"2.0\",\"method\":\"server/notice\",\"params\":{}}",
    JSON.stringify({
      id: 2,
      result: {
        ordinaryUsageAllowed: true,
        rateLimits: {
          limitId: "codex",
          primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1794373823 },
          secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: 1794568074 },
          credits: { hasCredits: false, unlimited: false, balance: "0" },
          planType: "plus",
          spendControlReached: false
        },
        rateLimitsByLimitId: {
          codex: {
            limitId: "codex",
            primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1794373823 },
            secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: 1794568074 },
            credits: { hasCredits: false, unlimited: false, balance: "0" },
            planType: "plus",
            spendControlReached: false
          }
        },
        rateLimitResetCredits: { availableCount: 2 }
      }
    })
  ].join("\n");

  const snap = parseCodexQuota(raw, now);
  assert.ok(snap);
  assert.equal(snap.pillText, "Codex 100/88%");
  assert.equal(snap.lowestFraction, 0.88);
  assert.equal(snap.level, "good");
  assert.deepEqual(snap.badges, ["PLUS", "2 resets"]);
  assert.equal(snap.groups[0].buckets[0].percentage, 100);
  assert.equal(snap.groups[0].buckets[1].percentage, 88);
  assert.equal(snap.groups[0].buckets[1].resetTime, new Date(1794568074 * 1000).toISOString());
});

test("parseCodexQuota handles over-100 usedPercent, single-window plans, and JSON-RPC errors", () => {
  const exhaustedRaw = JSON.stringify({
    id: 2,
    result: {
      ordinaryUsageAllowed: false,
      rateLimits: {
        limitId: "codex",
        primary: { usedPercent: 108, windowDurationMins: 300, resetsAt: 1794373823 },
        secondary: null,
        planType: "pro",
        spendControlReached: true
      }
    }
  });
  const snap = parseCodexQuota(exhaustedRaw, 1794355000000);
  assert.ok(snap);
  assert.equal(snap.pillText, "Codex 0%");
  assert.equal(snap.lowestFraction, 0);
  assert.equal(snap.level, "low");
  assert.deepEqual(snap.badges, ["PRO", "LIMIT REACHED"]);
  assert.equal(snap.groups[0].buckets.length, 1);

  assert.equal(parseCodexQuota(JSON.stringify({ id: 2, error: { code: -32600, message: "Unauthorized" } })), null);
});

test("mergeProviderResult preserves prior snapshot on transient error and providers wire exec cleanly", async () => {
  const prevSnap = { updatedAt: 100, lowestFraction: 0.8, level: "good", pillText: "Codex 100/80%", badges: [], groups: [] };
  const prev = mergeProviderResult(undefined, codexProvider, { ok: true, snapshot: prevSnap });
  assert.equal(prev.status, "ready");
  assert.equal(prev.snapshot, prevSnap);

  const afterErr = mergeProviderResult(prev, codexProvider, { ok: false, error: "timeout" });
  assert.equal(afterErr.status, "error");
  assert.equal(afterErr.error, "timeout");
  assert.equal(afterErr.snapshot, prevSnap);

  assert.ok(CODEX_RPC_SCRIPT.includes("account/rateLimits/read"));
  assert.ok(CODEX_RPC_SCRIPT.includes("p.kill()"));

  const calls = [];
  const fakeExec = async (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return { code: 0, stdout: "", stderr: "" };
  };
  await agyProvider.fetchRaw(fakeExec);
  await codexProvider.fetchRaw(fakeExec);
  assert.equal(calls[0].cmd, "agy");
  assert.equal(calls[1].cmd, "node");
  assert.equal(PROVIDERS.length, 2);
});

test("parseCodexQuota prioritizes codex limitId for pillText, zeroes level on spendControlReached, and guards Windows timeout cleanup", () => {
  const multiLimitRaw = JSON.stringify({
    id: 2,
    result: {
      ordinaryUsageAllowed: true,
      rateLimitsByLimitId: {
        codex_mini: {
          limitId: "codex_mini",
          primary: { usedPercent: 50, windowDurationMins: 300, resetsAt: 1794373823 },
          secondary: null
        },
        codex: {
          limitId: "codex",
          primary: { usedPercent: 0, windowDurationMins: 300, resetsAt: 1794373823 },
          secondary: { usedPercent: 12, windowDurationMins: 10080, resetsAt: 1794568074 },
          planType: "plus",
          spendControlReached: true
        }
      }
    }
  });

  const snap = parseCodexQuota(multiLimitRaw, 1794355000000);
  assert.ok(snap);
  assert.equal(snap.pillText, "Codex 100/88%");
  assert.equal(snap.lowestFraction, 0);
  assert.equal(snap.level, "low");
  assert.ok(snap.badges.includes("LIMIT REACHED"));

  assert.ok(CODEX_RPC_SCRIPT.includes("taskkill"));
  assert.ok(CODEX_RPC_SCRIPT.includes("() => cleanup(0)"));
});
