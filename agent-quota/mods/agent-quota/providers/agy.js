import { clampRemaining, getQuotaLevel } from "../helpers.js";

function formatPair(p5h, pwk) {
  if (p5h !== null && pwk !== null) {
    if (p5h === 100 && pwk === 100) return "100%";
    return `${p5h}/${pwk}%`;
  }
  if (p5h !== null) return `${p5h}%`;
  if (pwk !== null) return `${pwk}%`;
  return null;
}

export function parseAgyQuota(rawOutput, nowMs = Date.now()) {
  if (!rawOutput || typeof rawOutput !== "string") return null;
  let parsed;
  try {
    parsed = JSON.parse(rawOutput);
  } catch {
    return null;
  }

  const rawGroups = parsed?.command?.data?.groups;
  if (!Array.isArray(rawGroups) || rawGroups.length === 0) return null;

  let lowestFraction = 1.0;
  let totalBuckets = 0;
  let gemini5h = null;
  let geminiWeekly = null;
  let tp5h = null;
  let tpWeekly = null;

  const groups = rawGroups.map(group => {
    const rawBuckets = Array.isArray(group.buckets) ? group.buckets : [];
    const buckets = rawBuckets.map(b => {
      const fraction = clampRemaining(b.remaining_fraction);
      totalBuckets += 1;
      if (fraction < lowestFraction) lowestFraction = fraction;

      const percentage = Math.round(fraction * 100);
      const is5h = b.window === "5h" || (b.id && b.id.includes("5h")) || (b.name && b.name.toLowerCase().includes("five hour"));
      const isWeekly = b.window === "weekly" || (b.id && b.id.includes("weekly")) || (b.name && b.name.toLowerCase().includes("weekly"));
      const windowType = is5h ? "5h" : isWeekly ? "weekly" : (b.window || "other");

      const groupNameLower = (group.name || "").toLowerCase();
      if (groupNameLower.includes("gemini")) {
        if (windowType === "5h") gemini5h = percentage;
        if (windowType === "weekly") geminiWeekly = percentage;
      } else {
        if (windowType === "5h") tp5h = percentage;
        if (windowType === "weekly") tpWeekly = percentage;
      }

      return {
        id: b.id || "",
        name: b.name || "Limit Remaining",
        window: windowType,
        fraction,
        percentage,
        resetTime: b.reset_time || null,
        level: getQuotaLevel(fraction)
      };
    });

    const desc = group.description || "";
    const subtitle = desc.includes(":") ? desc.split(":").slice(1).join(":").trim() : desc.trim();

    return {
      name: group.name || "Model Quota",
      subtitle,
      buckets
    };
  }).filter(g => g.buckets.length > 0);

  if (totalBuckets === 0) return null;

  const parts = [];
  const gText = formatPair(gemini5h, geminiWeekly);
  const tpText = formatPair(tp5h, tpWeekly);
  if (gText) parts.push(`G:${gText}`);
  if (tpText) parts.push(`3P:${tpText}`);

  const pillText = parts.length > 0 ? `AGY ${parts.join(" · ")}` : "AGY";

  return {
    updatedAt: nowMs,
    lowestFraction,
    level: getQuotaLevel(lowestFraction),
    pillText,
    badges: [],
    groups
  };
}

export const agyProvider = {
  id: "agy",
  name: "Antigravity",
  shortLabel: "AGY",
  fetchRaw: exec => exec("agy", ["-p", "/usage", "--output-format", "json"], { timeout: 15000 }),
  parse: parseAgyQuota
};
