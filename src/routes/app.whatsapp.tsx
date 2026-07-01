import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  MessageCircle,
  CheckCircle2,
  AlertCircle,
  PhoneOff,
  RefreshCw,
  Facebook,
  Loader2,
  ExternalLink,
  Copy,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  getMyWhatsappConnection,
  disconnectWhatsapp,
  exchangeWhatsappSignup,
} from "@/lib/whatsapp.functions";

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
  phone_number_id: string | null;
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

const APP_ID =
  (import.meta.env.VITE_WHATSAPP_APP_ID as string | undefined) ?? "946931544897443";
const CONFIG_ID =
  (import.meta.env.VITE_WHATSAPP_CONFIG_ID as string | undefined) ?? "1996897057886691";
const GRAPH_VERSION =
  (import.meta.env.VITE_WHATSAPP_GRAPH_VERSION as string | undefined) ?? "v21.0";

const HOSTED_SIGNUP_URL =
  APP_ID && CONFIG_ID
    ? `https://business.facebook.com/messaging/whatsapp/onboard/?app_id=${APP_ID}&config_id=${CONFIG_ID}`
    : null;

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
            toast.error("Sign-up cancelled");
            return;
          }
          try {
            const { connection } = await exchangeFn({
              data: {
                code,
                wabaId: signupDataRef.current.wabaId,
                phoneNumberId: signupDataRef.current.phoneNumberId,
              },
            });
            if (!connection?.phone_number_id) {
              toast.warning(
                "Signed up, but Meta didn't return your phone-number ID. Refresh in a moment.",
              );
            } else {
              toast.success("WhatsApp connected");
            }
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
      toast.error(e instanceof Error ? e.message : "Failed to open sign-up");
    }
  };

  const disconnect = async () => {
    if (!conn) return;
    if (
      !confirm(
        "Disconnect WhatsApp? Customers will stop being able to reach you until you reconnect.",
      )
    )
      return;
    await disconnectFn({ data: { connectionId: conn.id } });
    toast.success("Disconnected");
    void load();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5 px-4 py-6">
      <header>
        <h1 className="flex items-center gap-2 text-lg font-bold sm:text-xl">
          <MessageCircle className="h-5 w-5 text-primary" /> WhatsApp
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect your WhatsApp Business number so customers can message you directly from the CRM.
        </p>
      </header>

      {loading ? (
        <div className="h-56 animate-pulse rounded-2xl border bg-muted/30" />
      ) : !conn ? (
        <NotConnectedCard connecting={connecting} onEmbedded={launchEmbeddedSignup} />
      ) : (
        <ConnectedCard conn={conn} onRefresh={load} onDisconnect={disconnect} />
      )}
    </div>
  );
}

function NotConnectedCard({
  connecting,
  onEmbedded,
}: {
  connecting: boolean;
  onEmbedded: () => void;
}) {
  return (
    <div className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex items-start gap-3">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <AlertCircle className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold">You're not connected yet</p>
          <p className="text-sm text-muted-foreground">
            Meta's Embedded Sign-up walks you through selecting your business, verifying your
            number, and granting the CRM access — all in one popup.
          </p>
        </div>
      </div>

      <ul className="space-y-2 text-sm">
        <Bullet>Choose or create a WhatsApp Business Account</Bullet>
        <Bullet>Verify the phone number you'll send from</Bullet>
        <Bullet>Grant the CRM permission to send &amp; receive on your behalf</Bullet>
      </ul>

      <div className="space-y-2">
        <Button
          onClick={onEmbedded}
          disabled={connecting}
          className="h-11 w-full bg-[#1877F2] text-white hover:bg-[#166fe0]"
        >
          {connecting ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Opening Meta sign-up…
            </>
          ) : (
            <>
              <Facebook className="mr-2 h-4 w-4" /> Continue with Facebook
            </>
          )}
        </Button>
        {HOSTED_SIGNUP_URL && (
          <a
            href={HOSTED_SIGNUP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1.5 rounded-md border bg-card px-3 py-2 text-xs text-muted-foreground transition hover:bg-muted"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Popup blocked? Open Meta sign-up in a new tab
          </a>
        )}
      </div>

      <div className="rounded-xl border bg-muted/30 p-3 text-xs text-muted-foreground">
        <p className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" /> What we receive from Meta
        </p>
        Only your WABA ID, phone-number ID and a permanent business access token — enough to send
        messages and receive replies. Your personal WhatsApp is never touched.
      </div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
      <span>{children}</span>
    </li>
  );
}

function ConnectedCard({
  conn,
  onRefresh,
  onDisconnect,
}: {
  conn: Connection;
  onRefresh: () => void;
  onDisconnect: () => void;
}) {
  const copy = async (label: string, value: string | null) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Copy failed");
    }
  };
  return (
    <div className="space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Connected number</p>
          <p className="truncate text-lg font-semibold sm:text-xl">{conn.phone_number}</p>
          {conn.display_name && (
            <p className="truncate text-sm text-muted-foreground">{conn.display_name}</p>
          )}
        </div>
        <StatusBadge status={conn.status} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Meta label="Quality" value={conn.quality_rating ?? "—"} />
        <Meta
          label="Connected on"
          value={conn.connected_at ? new Date(conn.connected_at).toLocaleDateString() : "—"}
        />
        <IdRow label="Phone number ID" value={conn.phone_number_id} onCopy={copy} />
        <IdRow label="WABA ID" value={conn.waba_id} onCopy={copy} />
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <Button variant="outline" onClick={onRefresh} className="h-10">
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh status
        </Button>
        <Button variant="destructive" onClick={onDisconnect} className="h-10">
          <PhoneOff className="mr-2 h-4 w-4" /> Disconnect
        </Button>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function IdRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string | null;
  onCopy: (label: string, value: string | null) => void;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs text-muted-foreground">{label}</p>
        {value && (
          <button
            type="button"
            onClick={() => onCopy(label, value)}
            className="text-muted-foreground hover:text-foreground"
            aria-label={`Copy ${label}`}
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <p className="truncate font-mono text-xs sm:text-sm">{value ?? "—"}</p>
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
