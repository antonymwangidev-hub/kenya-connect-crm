import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Plug, CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import {
  getGatewayStatus,
  connectGateway,
  disconnectGateway,
  setMessagingProvider,
  saveGatewayWebhookSecret,
  type GatewayStatus,
} from "@/lib/gateway.functions";

export function GatewaySection() {
  const loadStatus = useServerFn(getGatewayStatus);
  const connect = useServerFn(connectGateway);
  const disconnect = useServerFn(disconnectGateway);
  const setProvider = useServerFn(setMessagingProvider);
  const saveSecret = useServerFn(saveGatewayWebhookSecret);

  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState("");

  useEffect(() => {
    loadStatus()
      .then(({ status: s }) => {
        setStatus(s);
        setBaseUrl(s.base_url ?? "");
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load gateway status"));
  }, [loadStatus]);

  const refresh = async () => {
    const { status: s } = await loadStatus();
    setStatus(s);
    setBaseUrl(s.base_url ?? "");
  };

  const onConnect = async () => {
    if (!baseUrl.trim()) {
      toast.error("Enter the gateway Base URL");
      return;
    }
    setBusy(true);
    try {
      const res = await connect({
        data: { baseUrl: baseUrl.trim(), apiKey: apiKey.trim() || undefined, appUrl: window.location.origin },
      });
      setApiKey("");
      toast.success(`Connected${res.businessName ? ` to ${res.businessName}` : ""}`);
      if (res.webhookWarning) toast.warning(res.webhookWarning, { duration: 10000 });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Connection failed");
    } finally {
      setBusy(false);
    }
  };

  const onDisconnect = async () => {
    setBusy(true);
    try {
      await disconnect({});
      toast.success("Gateway disconnected — messaging switched back to Meta.");
      setApiKey("");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy(false);
    }
  };

  const onToggleProvider = async (useGateway: boolean) => {
    setBusy(true);
    try {
      await setProvider({ data: { provider: useGateway ? "gateway" : "meta" } });
      toast.success(useGateway ? "Now sending through the Nexus gateway" : "Now sending through Meta Cloud API");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Switch failed");
    } finally {
      setBusy(false);
    }
  };

  const onSaveSecret = async () => {
    if (!webhookSecret.trim()) {
      toast.error("Paste the signing secret from your gateway dashboard");
      return;
    }
    setBusy(true);
    try {
      await saveSecret({ data: { secret: webhookSecret.trim() } });
      setWebhookSecret("");
      toast.success("Signing secret saved — inbound replies will now be accepted.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the secret");
    } finally {
      setBusy(false);
    }
  };

  const manualWebhookUrl =
    status?.webhook_url ??
    (typeof window !== "undefined" && status?.webhook_token
      ? `${window.location.origin}/api/public/gateway/webhook/${status.webhook_token}`
      : "/api/public/gateway/webhook");

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Plug className="h-4 w-4" /> Nexus WhatsApp Gateway
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            An alternative way to send and receive WhatsApp messages. Your existing Meta Cloud API setup stays
            untouched — use the switch below to choose which one the app uses.
          </p>
        </div>
        {status?.connected && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 text-xs text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> Connected
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Base URL</Label>
          <Input
            placeholder="https://your-gateway.example.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </div>
        <div>
          <Label>API key</Label>
          <Input
            type="password"
            placeholder={status?.api_key_hint ? `Stored — ${status.api_key_hint} (leave blank to keep)` : "Not set"}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={onConnect} disabled={busy}>
          {busy ? "Working…" : status?.connected ? "Re-verify & save" : "Connect gateway"}
        </Button>
        {status?.connected && (
          <Button variant="outline" className="text-destructive" onClick={onDisconnect} disabled={busy}>
            Disconnect
          </Button>
        )}
      </div>

      {status?.connected && (
        <div className="space-y-3 border-t pt-4 text-xs">
          <div className="grid gap-1 sm:grid-cols-2">
            <div>Gateway account: <span className="font-medium">{status.business_name ?? "—"}</span></div>
            <div>
              WhatsApp on gateway:{" "}
              <span className="font-medium">{status.whatsapp_connected ? "Connected" : "Not connected"}</span>
            </div>
          </div>

          <div className="space-y-2 rounded-lg border bg-muted/30 p-2">
            <div className="flex items-center gap-2">
              <span className="truncate font-mono">{manualWebhookUrl}</span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  navigator.clipboard.writeText(manualWebhookUrl);
                  toast.success("Webhook URL copied");
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-muted-foreground">
              This receiving address belongs to this workspace only — every account you connect gets its own
              address and its own signing secret.
            </p>
          </div>

          {status.webhook_registered ? (
            <div className="flex items-center gap-2 text-emerald-600">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Receiving is active ({status.webhook_secret_source === "manual" ? "secret entered manually" : "set up automatically"}).
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-amber-700">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Automatic setup did not complete. Register the address above in your gateway dashboard, then paste
                the signing secret it gives you below.
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <Label>Webhook signing secret</Label>
              <Input
                type="password"
                placeholder={status.webhook_registered ? "Stored — paste a new one to replace" : "Paste the secret from your gateway"}
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
              />
            </div>
            <Button variant="outline" onClick={onSaveSecret} disabled={busy}>
              Save secret
            </Button>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/30 p-3">
            <div>
              <div className="text-sm font-medium">Send through the gateway</div>
              <p className="mt-0.5 text-muted-foreground">
                Off = Meta Cloud API (default). On = Nexus gateway. Applies to chat replies, automations, AI
                auto-replies and retries.
              </p>
            </div>
            <Switch
              checked={status.messaging_provider === "gateway"}
              disabled={busy}
              onCheckedChange={onToggleProvider}
            />
          </div>
        </div>
      )}
    </section>
  );
}
