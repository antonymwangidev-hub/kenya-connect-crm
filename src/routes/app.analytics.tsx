import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Users, MessageSquare, TrendingUp, Megaphone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/app/analytics")({
  component: AnalyticsPage,
});

type Stats = {
  contacts: number;
  inbound: number;
  outbound: number;
  broadcasts: number;
  byStage: Record<string, number>;
  byTag: { name: string; count: number }[];
};

const STAGES = ["new", "interested", "negotiation", "paid", "lost"] as const;
type Stage = (typeof STAGES)[number];

function AnalyticsPage() {
  const { businessId } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    if (!businessId) return;
    (async () => {
      const [contactsRes, msgRes, bcRes, tagsRes] = await Promise.all([
        supabase
          .from("contacts")
          .select("id,stage")
          .eq("business_id", businessId),
        supabase
          .from("messages")
          .select("direction,contact_id,contacts!inner(business_id)")
          .eq("contacts.business_id", businessId),
        supabase
          .from("broadcasts")
          .select("id", { count: "exact", head: true })
          .eq("business_id", businessId),
        supabase
          .from("tags")
          .select("id,name,contact_tags(contact_id)")
          .eq("business_id", businessId),
      ]);

      const contacts = contactsRes.data ?? [];
      const byStage: Record<string, number> = {};
      STAGES.forEach((s) => (byStage[s] = 0));
      contacts.forEach((c) => {
        byStage[c.stage] = (byStage[c.stage] ?? 0) + 1;
      });

      const msgs = (msgRes.data as { direction: string }[] | null) ?? [];
      const inbound = msgs.filter((m) => m.direction === "inbound").length;
      const outbound = msgs.filter((m) => m.direction === "outbound").length;

      const byTag =
        (tagsRes.data ?? []).map((t: { name: string; contact_tags: unknown[] }) => ({
          name: t.name,
          count: t.contact_tags?.length ?? 0,
        })) ?? [];

      setStats({
        contacts: contacts.length,
        inbound,
        outbound,
        broadcasts: bcRes.count ?? 0,
        byStage,
        byTag,
      });
    })();
  }, [businessId]);

  const conversion =
    stats && stats.contacts > 0
      ? Math.round(((stats.byStage.paid ?? 0) / stats.contacts) * 100)
      : 0;

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b bg-card px-6 py-4">
        <h1 className="text-xl font-semibold">Analytics</h1>
        <p className="text-sm text-muted-foreground">A quick view of your business activity.</p>
      </div>

      {!stats ? (
        <p className="p-6 text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-6 p-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard icon={Users} label="Total contacts" value={stats.contacts} />
            <StatCard icon={MessageSquare} label="Messages sent" value={stats.outbound} />
            <StatCard icon={MessageSquare} label="Messages received" value={stats.inbound} />
            <StatCard icon={Megaphone} label="Broadcasts" value={stats.broadcasts} />
          </div>

          <div className="rounded-lg border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-medium">Pipeline conversion</h2>
              <span className="flex items-center gap-1 text-sm font-medium text-emerald-600">
                <TrendingUp className="h-4 w-4" /> {conversion}% paid
              </span>
            </div>
            <div className="space-y-2">
              {STAGES.map((s) => {
                const count = stats.byStage[s] ?? 0;
                const pct = stats.contacts > 0 ? (count / stats.contacts) * 100 : 0;
                return (
                  <div key={s}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="capitalize">{s}</span>
                      <span className="text-muted-foreground">{count}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border bg-card p-5">
            <h2 className="mb-4 font-medium">Contacts per tag</h2>
            {stats.byTag.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tags yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {stats.byTag.map((t) => (
                  <span
                    key={t.name}
                    className="rounded-full border bg-background px-3 py-1 text-sm"
                  >
                    {t.name}{" "}
                    <span className="ml-1 text-xs text-muted-foreground">{t.count}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
}) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <Icon className="mb-2 h-5 w-5 text-muted-foreground" />
      <p className="text-2xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
