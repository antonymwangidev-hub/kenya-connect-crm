import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MessageCircle, CheckCircle2, AlertCircle, PhoneOff, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getMyWhatsappConnection, disconnectWhatsapp } from "@/lib/whatsapp.functions";

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

function WhatsappPage() {
  const navigate = useNavigate();
  const fetchFn = useServerFn(getMyWhatsappConnection);
  const disconnectFn = useServerFn(disconnectWhatsapp);
  const [conn, setConn] = useState<Connection | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const { connection } = await fetchFn();
      setConn((connection as Connection | null) ?? null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

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
            <p className="text-sm text-muted-foreground">Connect a number to start replying from your dashboard.</p>
          </div>
          <Button onClick={() => navigate({ to: "/app/onboarding" })} className="w-full">Connect WhatsApp</Button>
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
            <Button variant="outline" asChild>
              <Link to="/app/onboarding">
                <Plus className="mr-2 h-4 w-4" /> Connect another number
              </Link>
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
