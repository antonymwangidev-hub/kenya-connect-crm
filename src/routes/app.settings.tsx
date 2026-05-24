import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Settings as SettingsIcon, MessageCircle, Phone, CheckCircle2 } from "lucide-react";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

type Cred = { id?: string; provider: "whatsapp" | "africastalking" | "mpesa"; credentials: Record<string, string>; is_active: boolean };

function SettingsPage() {
  const { businessId, refreshBusiness } = useAuth();
  const [biz, setBiz] = useState<Record<string, unknown> | null>(null);
  const [creds, setCreds] = useState<Record<string, Cred>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    supabase.from("businesses").select("*").eq("id", businessId).single()
      .then(({ data }) => setBiz(data as Record<string, unknown>));
    supabase.from("channel_credentials").select("*").eq("business_id", businessId)
      .then(({ data }) => {
        const map: Record<string, Cred> = {};
        (data ?? []).forEach((c) => { map[c.provider] = c as unknown as Cred; });
        setCreds(map);
      });
  }, [businessId]);

  const updateBiz = (patch: Record<string, unknown>) => setBiz((b) => ({ ...(b ?? {}), ...patch }));
  const setCred = (provider: "whatsapp" | "africastalking" | "mpesa", patch: Partial<Cred>) =>
    setCreds((c) => ({
      ...c,
      [provider]: { provider, credentials: {}, is_active: false, ...(c[provider] ?? {}), ...patch },
    }));
  const setCredField = (provider: "whatsapp" | "africastalking" | "mpesa", k: string, v: string) =>
    setCred(provider, { credentials: { ...(creds[provider]?.credentials ?? {}), [k]: v } });

  const save = async () => {
    if (!businessId || !biz) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("businesses").update({
        name: biz.name, phone: biz.phone, mpesa_type: biz.mpesa_type, mpesa_number: biz.mpesa_number,
        default_greeting: biz.default_greeting, business_hours: biz.business_hours, logo_url: biz.logo_url,
      }).eq("id", businessId);
      if (error) throw error;
      for (const provider of ["whatsapp", "africastalking", "mpesa"] as const) {
        const c = creds[provider];
        if (!c) continue;
        await supabase.from("channel_credentials").upsert({
          business_id: businessId,
          provider,
          credentials: c.credentials,
          is_active: c.is_active,
        }, { onConflict: "business_id,provider" });
      }
      await refreshBusiness();
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  if (!biz) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="flex items-center gap-2 text-xl font-bold"><SettingsIcon className="h-5 w-5" /> Settings</h1>

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold">Business profile</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Name</Label><Input value={String(biz.name ?? "")} onChange={(e) => updateBiz({ name: e.target.value })} /></div>
          <div><Label>Phone</Label><Input value={String(biz.phone ?? "")} onChange={(e) => updateBiz({ phone: e.target.value })} /></div>
          <div><Label>M-Pesa type</Label>
            <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={String(biz.mpesa_type ?? "phone")}
              onChange={(e) => updateBiz({ mpesa_type: e.target.value })}>
              <option value="phone">Phone</option><option value="till">Till</option><option value="paybill">Paybill</option>
            </select>
          </div>
          <div><Label>M-Pesa number</Label><Input value={String(biz.mpesa_number ?? "")} onChange={(e) => updateBiz({ mpesa_number: e.target.value })} /></div>
        </div>
        <div><Label>Default greeting</Label><Textarea rows={2} value={String(biz.default_greeting ?? "")} onChange={(e) => updateBiz({ default_greeting: e.target.value })} /></div>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold flex items-center gap-2"><MessageCircle className="h-4 w-4" /> WhatsApp Business API</h2>
        <Input placeholder="Access token" value={creds.whatsapp?.credentials?.access_token ?? ""} onChange={(e) => setCredField("whatsapp", "access_token", e.target.value)} />
        <Input placeholder="Phone Number ID" value={creds.whatsapp?.credentials?.phone_number_id ?? ""} onChange={(e) => setCredField("whatsapp", "phone_number_id", e.target.value)} />
        <Input placeholder="Webhook verify token (optional)" value={creds.whatsapp?.credentials?.verify_token ?? ""} onChange={(e) => setCredField("whatsapp", "verify_token", e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!creds.whatsapp?.is_active} onChange={(e) => setCred("whatsapp", { is_active: e.target.checked })} /> Active</label>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold flex items-center gap-2"><Phone className="h-4 w-4" /> Africa's Talking SMS</h2>
        <Input placeholder="API key" value={creds.africastalking?.credentials?.api_key ?? ""} onChange={(e) => setCredField("africastalking", "api_key", e.target.value)} />
        <Input placeholder="Username" value={creds.africastalking?.credentials?.username ?? ""} onChange={(e) => setCredField("africastalking", "username", e.target.value)} />
        <Input placeholder="Sender ID (optional)" value={creds.africastalking?.credentials?.sender_id ?? ""} onChange={(e) => setCredField("africastalking", "sender_id", e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!creds.africastalking?.is_active} onChange={(e) => setCred("africastalking", { is_active: e.target.checked })} /> Active</label>
      </section>

      <Button onClick={save} disabled={saving}><CheckCircle2 className="mr-1 h-4 w-4" /> Save changes</Button>
    </div>
  );
}
