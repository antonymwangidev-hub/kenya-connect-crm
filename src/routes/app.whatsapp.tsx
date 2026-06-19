import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { MessageCircle, CheckCircle2, AlertCircle, PhoneOff, Plus, RefreshCw, Facebook, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMyWhatsappConnection, disconnectWhatsapp, exchangeWhatsappSignup } from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/app/whatsapp")({
  component: WhatsappPage,
});

type Connection = {
  id: string;
  phone_number: string;
  display_name: string | null;
  status: string;
  quality_rating: string | null;
  connected_at: string | null;
  waba_id: string | null;
};

declare global {
  interface Window {
    FB?: {
      init: (opts: Record<string, unknown>) => void;
      login: (
        cb: (resp: { authResponse?: { code?: string }; status?: string }) => void,
        opts: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

const APP_ID = import.meta.env.VITE_WHATSAPP_APP_ID as string | undefined;
const CONFIG_ID = import.meta.env.VITE_WHATSAPP_CONFIG_ID as string | undefined;
const GRAPH_VERSION = (import.meta.env.VITE_WHATSAPP_GRAPH_VERSION as string | undefined) ?? "v21.0";

function loadFbSdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("no window"));
    if (window.FB) return resolve();
    const existing = document.getElementById("facebook-jssdk");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({
        appId: APP_ID,
        cookie: true,
        xfbml: false,
        version: GRAPH_VERSION,
      });
      resolve();
    };
    const s = document.createElement("script");
    s.id = "facebook-jssdk";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.onerror = () => reject(new Error("Failed to load Facebook SDK"));
    document.body.appendChild(s);
  });
}

function WhatsappPage() {
  const navigate = useNavigate();
  const fetchFn = useServerFn(getMyWhatsappConnection);
  const disconnectFn = useServerFn(disconnectWhatsapp);
  const exchangeFn = useServerFn(exchangeWhatsappSignup);
  const [conn, setConn] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const signupDataRef = useRef<{ wabaId?: string; phoneNumberId?: string }>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { connection } = await fetchFn();
      setConn((connection as Connection | null) ?? null);
    } finally {
      setLoading(false);
    }
  }, [fetchFn]);

  useEffect(() => {
    void load();
  }, [load]);

  // Capture WABA / phone-number IDs delivered via postMessage from the popup.
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (typeof ev.data !== "string") return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (msg?.event === "FINISH") {
          signupDataRef.current = {
            wabaId: msg?.data?.waba_id,
            phoneNumberId: msg?.data?.phone_number_id,
          };
        }
      } catch {
        // not our message
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const launchEmbeddedSignup = async () => {
    if (!APP_ID || !CONFIG_ID) {
      toast.error("WhatsApp app not configured");
      return;
    }
    try {
      setConnecting(true);
      await loadFbSdk();
      window.FB!.login(
        async (response) => {
          const code = response?.authResponse?.code;
          if (!code) {
            setConnecting(false);
            toast.error("Signup cancelled");
            return;
          }
          try {
            await exchangeFn({
              data: {
                code,
                wabaId: signupDataRef.current.wabaId,
                phoneNumberId: signupDataRef.current.phoneNumberId,
              },
            });
            toast.success("WhatsApp connected");
            await load();
          } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : "Failed to connect");
          } finally {
            setConnecting(false);
          }
        },
        {
          config_id: CONFIG_ID,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
        },
      );
    } catch (e: unknown) {
      setConnecting(false);
      toast.error(e instanceof Error ? e.message : "Failed to open signup");
    }
  };

  const disconnect = async () => {
    if (!conn) return;
    if (!confirm("Disconnect WhatsApp? You'll need to connect again to send and receive messages.")) return;
    await disconnectFn({ data: { connectionId: conn.id } });
    toast.success("Disconnected");
    void load();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold">
          <MessageCircle className="h-5 w-5 text-primary" /> WhatsApp
        </h1>
        <p className="text-sm text-muted-foreground">Manage your business WhatsApp connection.</p>
      </div>

      {loading ? (
        <div className="h-40 animate-pulse rounded-2xl border bg-muted/30" />
      ) : !conn ? (
        <div className="space-y-4 rounded-2xl border bg-card p-6 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-primary/10 text-primary">
            <AlertCircle className="h-6 w-6" />
          </div>
          <div>
            <p className="font-semibold">Not connected yet</p>
            <p className="text-sm text-muted-foreground">
              Connect your WhatsApp Business account through Meta in one click — no copy-pasting tokens.
            </p>
          </div>
          <Button onClick={launchEmbeddedSignup} disabled={connecting} className="w-full bg-[#1877F2] hover:bg-[#166fe0] text-white">
            {connecting ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Connecting…</>
            ) : (
              <><Facebook className="mr-2 h-4 w-4" /> Continue with Facebook</>
            )}
          </Button>
          <button
            type="button"
            onClick={() => navigate({ to: "/app/onboarding" })}
            className="text-xs text-muted-foreground underline"
          >
            Or set up manually
          </button>
        </div>
      ) : (
        <div className="space-y-4 rounded-2xl border bg-card p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Connected number</p>
              <p className="text-lg font-semibold">{conn.phone_number}</p>
              {conn.display_name && <p className="text-sm text-muted-foreground">{conn.display_name}</p>}
            </div>
            <StatusBadge status={conn.status} />
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Quality</p>
              <p className="font-medium">{conn.quality_rating ?? "—"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Connected on</p>
              <p className="font-medium">
                {conn.connected_at ? new Date(conn.connected_at).toLocaleDateString() : "—"}
              </p>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant="outline" onClick={load}>
              <RefreshCw className="mr-2 h-4 w-4" /> Refresh status
            </Button>
            <Button
              onClick={launchEmbeddedSignup}
              disabled={connecting}
              className="bg-[#1877F2] hover:bg-[#166fe0] text-white"
            >
              {connecting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Connect another number
            </Button>
            <Button variant="outline" asChild className="sm:col-span-1">
              <Link to="/app/onboarding">Manual setup</Link>
            </Button>
            <Button variant="destructive" onClick={disconnect} className="sm:col-span-2">
              <PhoneOff className="mr-2 h-4 w-4" /> Disconnect
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "connected")
    return (
      <Badge className="bg-emerald-600 hover:bg-emerald-600">
        <CheckCircle2 className="mr-1 h-3 w-3" /> Connected
      </Badge>
    );
  if (status === "connecting")
    return <Badge variant="secondary">Connecting…</Badge>;
  if (status === "disconnected")
    return <Badge variant="outline">Disconnected</Badge>;
  return <Badge variant="destructive">{status}</Badge>;
}
