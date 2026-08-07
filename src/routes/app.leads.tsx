import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Flame, History, Loader2, RefreshCw, Search, Sliders, Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ContactAvatar } from "@/components/ContactAvatar";
import { breakdownEntries, formatDelta, scoreTier, tierClasses, TIER_LABEL } from "@/lib/lead-score";
import { toast } from "sonner";

export const Route = createFileRoute("/app/leads")({
  component: LeadsPage,
  head: () => ({
    meta: [
      { title: "Lead Scoring & Prioritization | PulseCRM" },
      { name: "description", content: "Automatically score every lead and work the hottest opportunities first." },
      { property: "og:title", content: "Lead Scoring & Prioritization | PulseCRM" },
      { property: "og:description", content: "Automatically score every lead and work the hottest opportunities first." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
});

type Lead = {
  id: string;
  name: string;
  phone: string;
  stage: string;
  avatar_url: string | null;
  lead_score: number;
  lead_score_updated_at: string | null;
};

type Rule = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  weight: number;
  is_active: boolean;
};

type HistoryRow = {
  id: string;
  old_score: number;
  new_score: number;
  reason: string | null;
  breakdown: Record<string, unknown> | null;
  created_at: string;
};

function LeadsPage() {
  const { businessId, canWrite } = useAuth();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [minScore, setMinScore] = useState(0);
  const [sortDesc, setSortDesc] = useState(true);
  const [recalcing, setRecalcing] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [historyFor, setHistoryFor] = useState<Lead | null>(null);
  const [history, setHistory] = useState<HistoryRow[]>([]);

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    await supabase.rpc("ensure_default_scoring_rules", { _business_id: businessId });
    const [{ data: cdata, error: cerr }, { data: rdata }] = await Promise.all([
      supabase
        .from("contacts")
        .select("id,name,phone,stage,avatar_url,lead_score,lead_score_updated_at")
        .eq("business_id", businessId)
        .order("lead_score", { ascending: false }),
      supabase
        .from("scoring_rules")
        .select("id,key,name,description,weight,is_active")
        .eq("business_id", businessId)
        .order("key"),
    ]);
    if (cerr) toast.error(cerr.message);
    setLeads((cdata as Lead[]) ?? []);
    setRules((rdata as Rule[]) ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [businessId]);

  const recalcAll = async () => {
    if (!businessId) return;
    setRecalcing(true);
    const { data, error } = await supabase.rpc("recalc_business_lead_scores", {
      _business_id: businessId,
      _reason: "manual_batch",
    });
    setRecalcing(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Rescored ${data ?? 0} leads`);
    load();
  };

  const recalcOne = async (id: string) => {
    const { error } = await supabase.rpc("recalc_lead_score", { _contact_id: id, _reason: "manual" });
    if (error) { toast.error(error.message); return; }
    load();
  };

  const saveRule = async (rule: Rule, weight: number) => {
    const { error } = await supabase.from("scoring_rules").update({ weight }).eq("id", rule.id);
    if (error) { toast.error(error.message); return; }
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, weight } : r)));
    toast.success("Weight saved — rescore to apply");
  };

  const toggleRule = async (rule: Rule) => {
    const { error } = await supabase
      .from("scoring_rules")
      .update({ is_active: !rule.is_active })
      .eq("id", rule.id);
    if (error) { toast.error(error.message); return; }
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, is_active: !r.is_active } : r)));
  };

  const openHistory = async (lead: Lead) => {
    setHistoryFor(lead);
    setHistory([]);
    const { data, error } = await supabase
      .from("lead_score_history")
      .select("id,old_score,new_score,reason,breakdown,created_at")
      .eq("contact_id", lead.id)
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) { toast.error(error.message); return; }
    setHistory((data as unknown as HistoryRow[]) ?? []);
  };

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads
      .filter((l) => Number(l.lead_score) >= minScore)
      .filter((l) => !q || l.name.toLowerCase().includes(q) || l.phone.includes(q))
      .sort((a, b) => (sortDesc ? b.lead_score - a.lead_score : a.lead_score - b.lead_score));
  }, [leads, search, minScore, sortDesc]);

  const hot = leads.filter((l) => scoreTier(Number(l.lead_score)) === "hot").length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b bg-card px-4 py-4 md:px-6">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Flame className="h-5 w-5 text-primary" /> Lead scoring
        </h1>
        <p className="text-sm text-muted-foreground">
          Every lead is scored 0–100 from pipeline stage, replies, recency and revenue. {hot} hot right now.
        </p>
      </div>

      <div className="space-y-4 p-4 md:p-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="relative min-w-[180px] flex-1">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search leads"
              className="pl-8"
            />
          </div>
          <div className="w-40">
            <Label className="text-xs text-muted-foreground">Min score: {minScore}</Label>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="w-full accent-primary"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setSortDesc((s) => !s)}>
            Score {sortDesc ? "↓" : "↑"}
          </Button>
          {canWrite && (
            <>
              <Button variant="outline" size="sm" onClick={() => setShowRules(true)}>
                <Sliders className="mr-1 h-4 w-4" /> Rules
              </Button>
              <Button size="sm" onClick={recalcAll} disabled={recalcing}>
                {recalcing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-1 h-4 w-4" />}
                Rescore all
              </Button>
            </>
          )}
        </div>

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}
          </div>
        ) : visible.length === 0 ? (
          <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">
            No leads match this filter.
          </CardContent></Card>
        ) : (
          <div className="space-y-2">
            {visible.map((l) => {
              const tier = scoreTier(Number(l.lead_score));
              return (
                <div key={l.id} className="flex items-center gap-3 rounded-lg border bg-card p-3">
                  <ContactAvatar name={l.name} avatarUrl={l.avatar_url} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{l.name}</p>
                    <p className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Phone className="h-3 w-3" />{l.phone} · {l.stage}
                    </p>
                  </div>
                  <div className="text-right">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${tierClasses(tier)}`}>
                      {Number(l.lead_score).toFixed(0)} · {TIER_LABEL[tier]}
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => openHistory(l)} title="Score history">
                    <History className="h-4 w-4" />
                  </Button>
                  {canWrite && (
                    <Button variant="ghost" size="icon" onClick={() => recalcOne(l.id)} title="Rescore">
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog open={showRules} onOpenChange={setShowRules}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Scoring rules</DialogTitle></DialogHeader>
          <div className="space-y-3">
            {rules.map((r) => (
              <Card key={r.id}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{r.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xs text-muted-foreground">{r.description}</p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      step="0.5"
                      defaultValue={r.weight}
                      className="w-24"
                      onBlur={(e) => {
                        const v = Number(e.target.value);
                        if (!Number.isNaN(v) && v !== r.weight) saveRule(r, v);
                      }}
                    />
                    <Button size="sm" variant={r.is_active ? "outline" : "secondary"} onClick={() => toggleRule(r)}>
                      {r.is_active ? "Active" : "Disabled"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
            <Button className="w-full" onClick={() => { setShowRules(false); recalcAll(); }} disabled={recalcing}>
              Apply & rescore all
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(historyFor)} onOpenChange={(o) => !o && setHistoryFor(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{historyFor?.name} — score history</DialogTitle></DialogHeader>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">No score changes recorded yet.</p>
          ) : (
            <div className="space-y-2">
              {history.map((h) => (
                <div key={h.id} className="rounded-md border p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {Number(h.old_score).toFixed(0)} → {Number(h.new_score).toFixed(0)}{" "}
                      <span className="text-xs text-muted-foreground">({formatDelta(Number(h.old_score), Number(h.new_score))})</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(h.created_at).toLocaleString()}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{h.reason}</p>
                  <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    {breakdownEntries(h.breakdown).map((b) => (
                      <span key={b.key} className="rounded bg-muted px-1.5 py-0.5">
                        {b.key}: {b.value.toFixed(1)}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
