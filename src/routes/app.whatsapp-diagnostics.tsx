import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, XCircle, RefreshCw, Loader2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  listWhatsappAccountsForDiagnostics,
  checkWhatsappSubscription,
  resubscribeWhatsappWebhook,
} from "@/lib/whatsapp-diagnostics.functions";

export const Route = createFileRoute("/app/whatsapp-diagnostics")({
  component: DiagnosticsPage,
});

type Account = {
  id: string;
  business_name: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  phone_number: string | null;
  status: string | null;
  source: string;
};

type SubStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; subscribed: boolean; apps: Array<{ id: string | null; name: string | null }> }
  | { state: "error"; message: string };

function DiagnosticsPage() {
  const listFn = useServerFn(listWhatsappAccountsForDiagnostics);
  const checkFn = useServerFn(checkWhatsappSubscription);
  const resubFn = useServerFn(resubscribeWhatsappWebhook);

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Record<string, SubStatus>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const keyFor = (a: Account) => `${a.waba_id ?? "?"}::${a.phone_number_id ?? "?"}`;

  const check = useCallback(
    async (a: Account) => {
      if (!a.waba_id) {
        setStatus((s) => ({ ...s, [keyFor(a)]: { state: "error", message: "Missing WABA ID on record" } }));
        return;
      }
      setStatus((s) => ({ ...s, [keyFor(a)]: { state: "checking" } }));
      try {
        const res = await checkFn({ data: { wabaId: a.waba_id, phoneNumberId: a.phone_number_id } });
        if (res.ok) {
          setStatus((s) => ({ ...s, [keyFor(a)]: { state: "ok", subscribed: res.subscribed, apps: res.apps ?? [] } }));
        } else {
          setStatus((s) => ({ ...s, [keyFor(a)]: { state: "error", message: res.error ?? "Check failed" } }));
        }
      } catch (err) {
        setStatus((s) => ({
          ...s,
          [keyFor(a)]: { state: "error", message: err instanceof Error ? err.message : "Check failed" },
        }));
      }
    },
    [checkFn],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { accounts } = await listFn();
      setAccounts(accounts);
      // Auto-check subscription for each
      accounts.forEach((a) => { void check(a); });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [listFn, check]);

  useEffect(() => { void load(); }, [load]);

  const resubscribe = async (a: Account) => {
    if (!a.waba_id) return toast.error("Missing WABA ID on this record");
    setBusy((b) => ({ ...b, [keyFor(a)]: true }));
    try {
      const res = await resubFn({ data: { wabaId: a.waba_id, phoneNumberId: a.phone_number_id } });
      if (res.ok) {
        toast.success("Webhook resubscribed");
        await check(a);
      } else {
        toast.error(res.error ?? "Resubscribe failed");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Resubscribe failed");
    } finally {
      setBusy((b) => ({ ...b, [keyFor(a)]: false }));
    }
  };

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">WhatsApp Webhook Diagnostics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Every connected WABA must have the app subscribed to its <code className="rounded bg-muted px-1">messages</code> field.
            Otherwise Meta won't POST inbound replies to your webhook.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {loading && accounts.length === 0 ? (
        <div className="grid place-items-center py-16 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No WhatsApp accounts connected yet.
        </div>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => {
            const st = status[keyFor(a)] ?? { state: "idle" };
            return (
              <div key={keyFor(a)} className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate font-medium">
                        {a.business_name || a.phone_number || "Unnamed WABA"}
                      </h3>
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                        {a.source === "whatsapp_business_accounts" ? "account" : "connection"}
                      </span>
                    </div>
                    <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
                      <div><dt className="inline font-medium">WABA ID:</dt> <dd className="inline font-mono">{a.waba_id ?? "—"}</dd></div>
                      <div><dt className="inline font-medium">Phone Number ID:</dt> <dd className="inline font-mono">{a.phone_number_id ?? "—"}</dd></div>
                      {a.phone_number && (
                        <div><dt className="inline font-medium">Number:</dt> <dd className="inline">{a.phone_number}</dd></div>
                      )}
                      <div><dt className="inline font-medium">Status:</dt> <dd className="inline">{a.status ?? "—"}</dd></div>
                    </dl>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <StatusBadge status={st} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => check(a)}
                      disabled={st.state === "checking"}
                    >
                      Check
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => resubscribe(a)}
                      disabled={busy[keyFor(a)] || !a.waba_id}
                    >
                      {busy[keyFor(a)] ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Resubscribe Webhook"}
                    </Button>
                  </div>
                </div>

                {st.state === "error" && (
                  <div className="mt-3 flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-700 dark:text-red-400">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span className="break-all">{st.message}</span>
                  </div>
                )}
                {st.state === "ok" && st.apps.length > 0 && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Subscribed apps: {st.apps.map((x) => x.name || x.id || "?").join(", ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: SubStatus }) {
  if (status.state === "checking") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]"><Loader2 className="h-3 w-3 animate-spin" /> Checking</span>;
  }
  if (status.state === "ok") {
    return status.subscribed ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-500/15 px-2 py-0.5 text-[11px] text-green-700 dark:text-green-400"><CheckCircle2 className="h-3 w-3" /> Subscribed</span>
    ) : (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-700 dark:text-amber-400"><XCircle className="h-3 w-3" /> Not subscribed</span>
    );
  }
  if (status.state === "error") {
    return <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] text-red-700 dark:text-red-400"><XCircle className="h-3 w-3" /> Error</span>;
  }
  return null;
}
