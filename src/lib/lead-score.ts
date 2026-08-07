export type LeadTier = "hot" | "warm" | "cool" | "cold";

export const TIER_LABEL: Record<LeadTier, string> = {
  hot: "Hot",
  warm: "Warm",
  cool: "Cool",
  cold: "Cold",
};

/** Buckets a 0-100 lead score into a priority tier. */
export function scoreTier(score: number): LeadTier {
  const s = Number.isFinite(score) ? score : 0;
  if (s >= 70) return "hot";
  if (s >= 45) return "warm";
  if (s >= 20) return "cool";
  return "cold";
}

/** Tailwind classes for a tier badge, using semantic tokens where possible. */
export function tierClasses(tier: LeadTier): string {
  switch (tier) {
    case "hot":
      return "bg-primary text-primary-foreground";
    case "warm":
      return "bg-accent text-accent-foreground";
    case "cool":
      return "bg-secondary text-secondary-foreground";
    default:
      return "bg-muted text-muted-foreground";
  }
}

export const RULE_ORDER = [
  "stage",
  "inbound_activity",
  "outbound_engagement",
  "revenue",
  "recency",
  "dormant_penalty",
] as const;

/** Human readable delta, e.g. "+12.5" or "-3". */
export function formatDelta(oldScore: number, newScore: number): string {
  const d = Math.round((newScore - oldScore) * 10) / 10;
  return `${d > 0 ? "+" : ""}${d}`;
}

/** Sorts a breakdown object into ordered, labelled contribution entries. */
export function breakdownEntries(breakdown: Record<string, unknown> | null | undefined) {
  if (!breakdown) return [] as Array<{ key: string; value: number }>;
  return RULE_ORDER.filter((k) => breakdown[k] !== undefined).map((k) => ({
    key: k,
    value: Number(breakdown[k] ?? 0),
  }));
}
