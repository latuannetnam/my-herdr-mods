export function clampRemaining(fraction) {
  const f = Number(fraction);
  if (Number.isNaN(f)) return 0;
  return Math.max(0, Math.min(1, f));
}

export function getQuotaLevel(fraction) {
  const f = Number(fraction);
  if (Number.isNaN(f)) return "low";
  if (f > 0.5) return "good";
  if (f >= 0.2) return "warn";
  return "low";
}

export function formatCountdown(isoString, nowMs = Date.now()) {
  if (!isoString) return "Ready";
  const targetMs = Date.parse(isoString);
  if (Number.isNaN(targetMs)) return "Ready";
  const diffMs = targetMs - nowMs;
  if (diffMs <= 0) return "Ready";

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return "< 1m";

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;

  const diffHours = Math.floor(diffMin / 60);
  const remainingMins = diffMin % 60;
  if (diffHours < 24) {
    return remainingMins > 0 ? `${diffHours}h ${remainingMins}m` : `${diffHours}h`;
  }

  const diffDays = Math.floor(diffHours / 24);
  const remainingHours = diffHours % 24;
  return remainingHours > 0 ? `${diffDays}d ${remainingHours}h` : `${diffDays}d`;
}

export function mergeProviderResult(prevEntry, provider, outcome) {
  const base = {
    id: provider.id,
    name: provider.name,
    shortLabel: provider.shortLabel
  };
  if (outcome.ok && outcome.snapshot) {
    return {
      ...base,
      status: "ready",
      error: null,
      snapshot: outcome.snapshot
    };
  }
  return {
    ...base,
    status: "error",
    error: outcome.error || `${provider.name} quota unavailable`,
    snapshot: prevEntry?.snapshot ?? null
  };
}

export function resolveActiveTab(requestedTab, providers) {
  if (!requestedTab || requestedTab === "all") return "all";
  return providers.some(p => p.id === requestedTab) ? requestedTab : "all";
}
