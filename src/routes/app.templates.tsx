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
import { FileText, Plus, Trash2, RefreshCw, MessageSquare, Search, AlertCircle } from "lucide-react";
import {
  listWhatsappTemplates,
  syncWhatsappTemplates,
  listWhatsappAccounts,
} from "@/lib/whatsapp-templates.functions";

export const Route = createFileRoute("/app/templates")({
  component: TemplatesPage,
});

type Tpl = { id: string; name: string; body: string; category: string };
type WaTpl = {
  id: string;
  business_account_id: string;
  waba_id: string | null;
  name: string;
  language: string;
  category: string | null;
  status: string;
  components: Array<{ type: string; format?: string; text?: string; buttons?: unknown[] }>;
  last_synced_at: string;
};
type WaAccount = {
  id: string;
  business_name: string;
  waba_id: string;
  phone_number_id: string;
  status: string;
};

const SELECTED_ACCOUNT_KEY = "wa.selectedAccountId";

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
  const accountsFn = useServerFn(listWhatsappAccounts);

  const [accounts, setAccounts] = useState<WaAccount[]>([]);
  const [accountId, setAccountId] = useState<string>("");
  const [accountsLoading, setAccountsLoading] = useState(true);

  const [list, setList] = useState<Tpl[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");

  const [wa, setWa] = useState<WaTpl[]>([]);
  const [waLoading, setWaLoading] = useState(false);
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

  // Load accounts, pick a default (persisted or first).
  useEffect(() => {
    (async () => {
      setAccountsLoading(true);
      try {
        const { accounts: rows } = await accountsFn();
        const list = (rows as unknown as WaAccount[]) ?? [];
        setAccounts(list);
        const stored = typeof window !== "undefined" ? localStorage.getItem(SELECTED_ACCOUNT_KEY) : null;
        const initial = list.find((a) => a.id === stored)?.id ?? list[0]?.id ?? "";
        setAccountId(initial);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load WhatsApp accounts");
      } finally {
        setAccountsLoading(false);
      }
    })();
  }, [accountsFn]);

  const loadWa = async (id: string) => {
    if (!id) { setWa([]); return; }
    setWaLoading(true);
    try {
      const { templates } = await listFn({ data: { accountId: id } });
      setWa((templates as unknown as WaTpl[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load templates");
    } finally {
      setWaLoading(false);
    }
  };

  useEffect(loadLocal, [businessId]);
  useEffect(() => {
    if (!accountId) return;
    if (typeof window !== "undefined") localStorage.setItem(SELECTED_ACCOUNT_KEY, accountId);
    void loadWa(accountId);
  }, [accountId]);

  const sync = async () => {
    if (!accountId) return;
    setSyncing(true);
    try {
      const { count } = await syncFn({ data: { accountId } });
      toast.success(`Synced ${count} templates from Meta`);
      await loadWa(accountId);
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

  const selectedAccount = accounts.find((a) => a.id === accountId) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-4 py-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex items-center gap-2 text-xl font-bold">
            <MessageSquare className="h-5 w-5 text-primary" /> WhatsApp Template Library
          </h1>
          <Button onClick={sync} disabled={syncing || !accountId} size="sm" className="ml-auto gap-1">
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "Syncing…" : "Sync from Meta"}
          </Button>
        </div>

        {/* Account selector */}
        <div className="rounded-2xl border bg-card p-3">
          <label className="mb-1.5 block text-[11px] font-semibold uppercase text-muted-foreground">
            WhatsApp Business Account
          </label>
          {accountsLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : accounts.length === 0 ? (
            <div className="flex items-start gap-2 text-sm text-muted-foreground">
              <AlertCircle className="mt-0.5 h-4 w-4 text-amber-500" />
              <span>No WhatsApp accounts connected. Go to WhatsApp settings and connect via Meta Embedded Signup.</span>
            </div>
          ) : (
            <>
              <select
                className="h-10 w-full rounded-md border bg-background px-2 text-sm"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.business_name} — WABA {a.waba_id.slice(0, 10)}…
                  </option>
                ))}
              </select>
              {selectedAccount && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  WABA: <span className="font-mono">{selectedAccount.waba_id}</span> · Phone#{" "}
                  <span className="font-mono">{selectedAccount.phone_number_id}</span>
                </p>
              )}
            </>
          )}
        </div>

        <p className="text-sm text-muted-foreground">
          Templates below belong only to the selected account. Switch accounts to view a different WABA's templates.
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
        ) : !accountId ? (
          <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
            Select a WhatsApp account to view its templates.
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border bg-card p-6 text-center text-sm text-muted-foreground">
            {wa.length === 0
              ? "No templates yet for this account. Click \"Sync from Meta\" to import approved templates."
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
                  {header?.text && <p className="text-xs font-medium">{header.text}</p>}
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
