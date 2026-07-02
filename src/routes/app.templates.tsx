import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { FileText, Plus, Trash2, RefreshCw, MessageSquare, Search } from "lucide-react";
import { listWhatsappTemplates, syncWhatsappTemplates } from "@/lib/whatsapp-templates.functions";

export const Route = createFileRoute("/app/templates")({
  component: TemplatesPage,
});

type Tpl = { id: string; name: string; body: string; category: string };
type WaTpl = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  components: Array<{ type: string; format?: string; text?: string; buttons?: unknown[] }>;
  last_synced_at: string;
};

function StatusBadge({ status }: { status: string }) {
  const s = status.toUpperCase();
  const cls =
    s === "APPROVED"
      ? "bg-green-500/15 text-green-600"
      : s === "PENDING"
      ? "bg-amber-500/15 text-amber-600"
      : s === "REJECTED"
      ? "bg-red-500/15 text-red-600"
      : "bg-muted text-muted-foreground";
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{s}</span>;
}

function bodyText(t: WaTpl) {
  return t.components.find((c) => c.type === "BODY")?.text ?? "";
}

function TemplatesPage() {
  const { businessId } = useAuth();
  const listFn = useServerFn(listWhatsappTemplates);
  const syncFn = useServerFn(syncWhatsappTemplates);

  // Local "quick reply" templates (existing message_templates table)
  const [list, setList] = useState<Tpl[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");

  // WhatsApp templates
  const [wa, setWa] = useState<WaTpl[]>([]);
  const [waLoading, setWaLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<string>("ALL");
  const [fLang, setFLang] = useState<string>("ALL");
  const [fCat, setFCat] = useState<string>("ALL");

  const loadLocal = () => {
    if (!businessId) return;
    supabase
      .from("message_templates")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .then(({ data }) => setList((data as Tpl[]) ?? []));
  };

  const loadWa = async () => {
    setWaLoading(true);
    try {
      const { templates } = await listFn();
      setWa((templates as unknown as WaTpl[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setWaLoading(false);
    }
  };

  useEffect(loadLocal, [businessId]);
  useEffect(() => { loadWa(); }, []);

  const sync = async () => {
    setSyncing(true);
    try {
      const { count } = await syncFn();
      toast.success(`Synced ${count} templates from Meta`);
      await loadWa();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const add = async () => {
    if (!businessId || !name.trim() || !body.trim()) return;
    const { error } = await supabase
      .from("message_templates")
      .insert({ business_id: businessId, name, body, category });
    if (error) return toast.error(error.message);
    setName(""); setBody(""); setCategory("general");
    toast.success("Template added");
    loadLocal();
  };
  const del = async (id: string) => {
    await supabase.from("message_templates").delete().eq("id", id);
    loadLocal();
  };

  const languages = useMemo(() => Array.from(new Set(wa.map((t) => t.language))).sort(), [wa]);
  const categories = useMemo(
    () => Array.from(new Set(wa.map((t) => t.category).filter(Boolean) as string[])).sort(),
    [wa],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return wa.filter((t) => {
      if (fStatus !== "ALL" && t.status.toUpperCase() !== fStatus) return false;
      if (fLang !== "ALL" && t.language !== fLang) return false;
      if (fCat !== "ALL" && (t.category ?? "") !== fCat) return false;
      if (needle && !(t.name.toLowerCase().includes(needle) || bodyText(t).toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [wa, q, fStatus, fLang, fCat]);

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6">
      {/* WhatsApp Template Library */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <MessageSquare className="h-5 w-5 text-primary" /> WhatsApp Template Library
          </h1>
          <Button onClick={sync} disabled={syncing} size="sm" className="ml-auto gap-1">
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync from Meta"}
          </Button>
        </div>
        <p className="text-sm text-muted-foreground">
          Approved Meta templates can be sent at any time. Pending and rejected templates are shown for visibility.
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="h-9 pl-8" placeholder="Search templates…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="ALL">All statuses</option>
            <option value="APPROVED">Approved</option>
            <option value="PENDING">Pending</option>
            <option value="REJECTED">Rejected</option>
            <option value="DISABLED">Disabled</option>
          </select>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={fLang} onChange={(e) => setFLang(e.target.value)}>
            <option value="ALL">All languages</option>
            {languages.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          <select className="h-9 rounded-md border bg-background px-2 text-sm" value={fCat} onChange={(e) => setFCat(e.target.value)}>
            <option value="ALL">All categories</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {waLoading ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
            {wa.length === 0
              ? "No templates yet. Click \"Sync from Meta\" to import your approved templates."
              : "No templates match the current filters."}
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {filtered.map((t) => {
              const header = t.components.find((c) => c.type === "HEADER");
              const footer = t.components.find((c) => c.type === "FOOTER")?.text;
              return (
                <div key={t.id} className="space-y-2 rounded-2xl border bg-card p-4 transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{t.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {(t.category ?? "—")} · {t.language}
                      </p>
                    </div>
                    <StatusBadge status={t.status} />
                  </div>
                  {header?.text && (
                    <p className="text-xs font-medium">{header.text}</p>
                  )}
                  {header?.format && header.format !== "TEXT" && (
                    <p className="text-[11px] uppercase text-muted-foreground">{header.format} header</p>
                  )}
                  <p className="whitespace-pre-wrap text-xs text-muted-foreground">{bodyText(t) || "—"}</p>
                  {footer && <p className="text-[11px] italic text-muted-foreground">{footer}</p>}
                  <p className="text-[10px] text-muted-foreground">
                    Synced {new Date(t.last_synced_at).toLocaleString()}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Local quick-reply templates */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-bold">
          <FileText className="h-5 w-5" /> Quick reply templates
        </h2>
        <p className="text-sm text-muted-foreground">
          Internal snippets you can paste into open conversations (within the 24-hour session window).
        </p>

        <div className="space-y-2 rounded-2xl border bg-card p-4">
          <Input placeholder="Template name (e.g. Welcome)" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <Textarea rows={3} placeholder="Message body. Use {{name}} for contact name." value={body} onChange={(e) => setBody(e.target.value)} />
          <Button onClick={add} disabled={!name || !body}><Plus className="mr-1 h-4 w-4" /> Add template</Button>
        </div>

        <div className="space-y-2">
          {list.length === 0 ? (
            <p className="text-sm text-muted-foreground">No quick replies yet.</p>
          ) : list.map((t) => (
            <div key={t.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
              <div className="flex-1">
                <p className="text-sm font-semibold">{t.name} <span className="text-xs text-muted-foreground">· {t.category}</span></p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
              </div>
              <button onClick={() => del(t.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
