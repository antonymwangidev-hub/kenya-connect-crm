import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, ArrowLeft, Send } from "lucide-react";
import { toast } from "sonner";
import { listWhatsappTemplates, sendWhatsappTemplate, syncWhatsappTemplates } from "@/lib/whatsapp-templates.functions";

export type WaTpl = {
  id: string;
  name: string;
  language: string;
  category: string | null;
  status: string;
  components: Array<{
    type: string;
    format?: string;
    text?: string;
    buttons?: Array<{ type: string; text?: string; url?: string }>;
  }>;
};

function bodyText(t: WaTpl) {
  return t.components.find((c) => c.type === "BODY")?.text ?? "";
}
function headerComp(t: WaTpl) {
  return t.components.find((c) => c.type === "HEADER");
}
function buttonsComp(t: WaTpl) {
  return t.components.find((c) => c.type === "BUTTONS")?.buttons ?? [];
}

function countBodyVars(text: string) {
  const matches = text.match(/\{\{\s*(\d+)\s*\}\}/g) ?? [];
  if (matches.length === 0) return 0;
  const nums = matches.map((m) => Number(m.replace(/[^\d]/g, "")));
  return Math.max(...nums);
}

function renderPreview(text: string, values: string[]) {
  let out = text;
  values.forEach((v, i) => {
    out = out.replace(new RegExp(`\\{\\{\\s*${i + 1}\\s*\\}\\}`, "g"), v || `{{${i + 1}}}`);
  });
  return out;
}

type Props = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  contactId: string;
  contactName: string;
  onSent?: () => void;
};

export function SendTemplateModal({ open, onOpenChange, contactId, contactName, onSent }: Props) {
  const listFn = useServerFn(listWhatsappTemplates);
  const syncFn = useServerFn(syncWhatsappTemplates);
  const sendFn = useServerFn(sendWhatsappTemplate);

  const [templates, setTemplates] = useState<WaTpl[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("ALL");
  const [step, setStep] = useState<"select" | "fill">("select");
  const [selected, setSelected] = useState<WaTpl | null>(null);
  const [bodyVals, setBodyVals] = useState<string[]>([]);
  const [headerVals, setHeaderVals] = useState<string[]>([]);
  const [btnVals, setBtnVals] = useState<Record<number, string>>({});
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setStep("select");
    setSelected(null);
    setQ("");
    setLoading(true);
    listFn()
      .then(({ templates: t }) => setTemplates((t as unknown as WaTpl[]) ?? []))
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [open, listFn]);

  const approved = useMemo(() => templates.filter((t) => t.status.toUpperCase() === "APPROVED"), [templates]);
  const categories = useMemo(
    () => Array.from(new Set(approved.map((t) => t.category).filter(Boolean) as string[])).sort(),
    [approved],
  );
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return approved.filter((t) => {
      if (cat !== "ALL" && (t.category ?? "") !== cat) return false;
      if (needle && !(t.name.toLowerCase().includes(needle) || bodyText(t).toLowerCase().includes(needle))) return false;
      return true;
    });
  }, [approved, q, cat]);

  const pick = (t: WaTpl) => {
    setSelected(t);
    const body = bodyText(t);
    setBodyVals(Array.from({ length: countBodyVars(body) }, () => ""));
    const h = headerComp(t);
    const headerVarCount =
      h?.format === "TEXT" && h.text ? countBodyVars(h.text) : h && h.format !== "TEXT" ? 1 : 0;
    setHeaderVals(Array.from({ length: headerVarCount }, () => ""));
    setBtnVals({});
    setStep("fill");
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { count } = await syncFn();
      toast.success(`Synced ${count} templates`);
      const { templates: t } = await listFn();
      setTemplates((t as unknown as WaTpl[]) ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const send = async () => {
    if (!selected) return;
    // Validate variables
    if (bodyVals.some((v) => !v.trim())) return toast.error("Fill all body variables");
    if (headerVals.some((v) => !v.trim())) return toast.error("Fill header variable");
    setSending(true);
    try {
      const buttons = Object.entries(btnVals)
        .filter(([, v]) => v.trim())
        .map(([idx, value]) => ({ index: Number(idx), value }));
      await sendFn({
        data: {
          contactId,
          templateId: selected.id,
          variables: {
            body: bodyVals,
            header: headerVals.length > 0 ? headerVals : undefined,
            buttons: buttons.length > 0 ? buttons : undefined,
          },
        },
      });
      toast.success("Template sent");
      onOpenChange(false);
      onSent?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  };

  const dynamicBtns = selected ? buttonsComp(selected).filter((b) => b.type === "URL" && (b.url ?? "").includes("{{")) : [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {step === "fill" && (
              <button onClick={() => setStep("select")} className="rounded-md p-1 hover:bg-muted">
                <ArrowLeft className="h-4 w-4" />
              </button>
            )}
            {step === "select" ? "Send a WhatsApp template" : `Send "${selected?.name}" to ${contactName}`}
          </DialogTitle>
        </DialogHeader>

        {step === "select" ? (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-[160px]">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="h-9 pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              <select className="h-9 rounded-md border bg-background px-2 text-sm" value={cat} onChange={(e) => setCat(e.target.value)}>
                <option value="ALL">All categories</option>
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              <Button onClick={handleSync} disabled={syncing} size="sm" variant="outline">
                {syncing ? "Syncing…" : "Refresh"}
              </Button>
            </div>

            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
              {loading ? (
                Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
              ) : filtered.length === 0 ? (
                <p className="rounded-lg border bg-card p-4 text-center text-sm text-muted-foreground">
                  {approved.length === 0
                    ? "No approved templates. Click Refresh to sync from Meta."
                    : "No templates match the filters."}
                </p>
              ) : (
                filtered.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => pick(t)}
                    className="w-full rounded-lg border bg-card p-3 text-left transition hover:border-primary hover:bg-accent"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold">{t.name}</p>
                      <span className="text-[10px] text-muted-foreground">{(t.category ?? "—")} · {t.language}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{bodyText(t)}</p>
                  </button>
                ))
              )}
            </div>
          </div>
        ) : selected ? (
          <div className="space-y-4">
            {/* Header variables */}
            {headerVals.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  Header ({headerComp(selected)?.format ?? "TEXT"})
                </p>
                {headerVals.map((v, i) => {
                  const fmt = (headerComp(selected)?.format ?? "TEXT").toUpperCase();
                  const placeholder = fmt === "TEXT" ? `Variable {{${i + 1}}}` : `${fmt} URL (https://…)`;
                  return (
                    <Input
                      key={i}
                      value={v}
                      onChange={(e) => {
                        const next = [...headerVals];
                        next[i] = e.target.value;
                        setHeaderVals(next);
                      }}
                      placeholder={placeholder}
                    />
                  );
                })}
              </div>
            )}

            {/* Body variables */}
            {bodyVals.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase text-muted-foreground">Body variables</p>
                {bodyVals.map((v, i) => (
                  <Input
                    key={i}
                    value={v}
                    onChange={(e) => {
                      const next = [...bodyVals];
                      next[i] = e.target.value;
                      setBodyVals(next);
                    }}
                    placeholder={`Variable {{${i + 1}}}`}
                  />
                ))}
              </div>
            )}

            {/* Dynamic URL button variables */}
            {dynamicBtns.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium uppercase text-muted-foreground">Button URL parameters</p>
                {dynamicBtns.map((b, idx) => (
                  <Input
                    key={idx}
                    value={btnVals[idx] ?? ""}
                    onChange={(e) => setBtnVals({ ...btnVals, [idx]: e.target.value })}
                    placeholder={b.text ?? `Button ${idx + 1}`}
                  />
                ))}
              </div>
            )}

            {/* Preview */}
            <div className="rounded-lg border bg-muted/40 p-3">
              <p className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Preview</p>
              {headerComp(selected)?.text && (
                <p className="text-xs font-semibold">
                  {renderPreview(headerComp(selected)!.text!, headerVals)}
                </p>
              )}
              <p className="mt-1 whitespace-pre-wrap text-sm">
                {renderPreview(bodyText(selected), bodyVals)}
              </p>
              {selected.components.find((c) => c.type === "FOOTER")?.text && (
                <p className="mt-2 text-[11px] italic text-muted-foreground">
                  {selected.components.find((c) => c.type === "FOOTER")?.text}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("select")} disabled={sending}>Back</Button>
              <Button onClick={send} disabled={sending} className="gap-1">
                <Send className="h-4 w-4" /> {sending ? "Sending…" : "Send template"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
