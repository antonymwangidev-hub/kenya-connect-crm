import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Settings as SettingsIcon, MessageCircle, Phone, CheckCircle2, ShieldCheck, Bot } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  listChannelCredentials,
  upsertChannelCredentials,
} from "@/lib/channel-credentials.functions";
import {
  getAiAssistantSettings,
  saveAiAssistantSettings,
  type AiAssistantSettings,
} from "@/lib/ai-assistant.functions";
import { KnowledgeBaseSection } from "@/components/KnowledgeBaseSection";
import { GatewaySection } from "@/components/GatewaySection";

export const Route = createFileRoute("/app/settings")({
  component: SettingsPage,
});

type Provider = "whatsapp" | "africastalking" | "mpesa";
type CredMeta = {
  provider: Provider;
  is_active: boolean;
  has_secrets: boolean;
  public_fields: Record<string, string>;
  secret_hints: Record<string, string>;
};
type Biz = {
  id?: string; name?: string; phone?: string | null; mpesa_type?: string | null; mpesa_number?: string | null;
  default_greeting?: string | null; business_hours?: unknown; logo_url?: string | null;
};

// Local form state — secret fields stay empty unless the user types a new value.
type Form = {
  is_active: boolean;
  public_fields: Record<string, string>;
  secret_fields: Record<string, string>;
};

function emptyForm(): Form {
  return { is_active: false, public_fields: {}, secret_fields: {} };
}

function SettingsPage() {
  const { businessId, refreshBusiness } = useAuth();
  const [biz, setBiz] = useState<Biz | null>(null);
  const [meta, setMeta] = useState<Record<Provider, CredMeta | undefined>>({
    whatsapp: undefined, africastalking: undefined, mpesa: undefined,
  });
  const [forms, setForms] = useState<Record<Provider, Form>>({
    whatsapp: emptyForm(), africastalking: emptyForm(), mpesa: emptyForm(),
  });
  const [saving, setSaving] = useState(false);
  const [ai, setAi] = useState<AiAssistantSettings | null>(null);
  const [savingAi, setSavingAi] = useState(false);

  const listCreds = useServerFn(listChannelCredentials);
  const saveCreds = useServerFn(upsertChannelCredentials);
  const loadAi = useServerFn(getAiAssistantSettings);
  const saveAi = useServerFn(saveAiAssistantSettings);

  useEffect(() => {
    if (!businessId) return;
    supabase.from("businesses").select("*").eq("id", businessId).single()
      .then(({ data }) => setBiz((data as Biz) ?? null));
    loadAi().then(({ settings }) => setAi(settings)).catch((e) =>
      toast.error(e instanceof Error ? e.message : "Failed to load AI settings"),
    );
    listCreds().then(({ creds }) => {
      const m: Record<Provider, CredMeta | undefined> = {
        whatsapp: undefined, africastalking: undefined, mpesa: undefined,
      };
      const f: Record<Provider, Form> = {
        whatsapp: emptyForm(), africastalking: emptyForm(), mpesa: emptyForm(),
      };
      for (const c of creds) {
        m[c.provider] = c;
        f[c.provider] = {
          is_active: c.is_active,
          public_fields: { ...c.public_fields },
          secret_fields: {},
        };
      }
      setMeta(m);
      setForms(f);
    }).catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"));
  }, [businessId, listCreds, loadAi]);

  const updateAi = (patch: Partial<AiAssistantSettings>) =>
    setAi((prev) => (prev ? { ...prev, ...patch } : prev));

  const persistAi = async (next?: Partial<AiAssistantSettings>) => {
    if (!ai) return;
    const merged = { ...ai, ...(next ?? {}) };
    setAi(merged);
    setSavingAi(true);
    try {
      await saveAi({
        data: {
          enabled: merged.enabled,
          business_description: merged.business_description ?? "",
          products_services: merged.products_services ?? "",
          contact_info: merged.contact_info ?? "",
          address: merged.address ?? "",
          website: merged.website ?? "",
          hours: merged.hours ?? "",
          faqs: merged.faqs ?? "",
          tone: (merged.tone ?? "friendly") as "friendly" | "professional" | "casual" | "sales",
          custom_instructions: merged.custom_instructions ?? "",
          strict_knowledge: merged.strict_knowledge !== false,
          fallback_message: merged.fallback_message ?? "",
        },
      });
      toast.success("AI assistant saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingAi(false);
    }
  };

  const updateBiz = (patch: Partial<Biz>) => setBiz((b) => ({ ...(b ?? {}), ...patch }));
  const setPublic = (p: Provider, k: string, v: string) =>
    setForms((s) => ({ ...s, [p]: { ...s[p], public_fields: { ...s[p].public_fields, [k]: v } } }));
  const setSecret = (p: Provider, k: string, v: string) =>
    setForms((s) => ({ ...s, [p]: { ...s[p], secret_fields: { ...s[p].secret_fields, [k]: v } } }));
  const setActive = (p: Provider, v: boolean) =>
    setForms((s) => ({ ...s, [p]: { ...s[p], is_active: v } }));

  const save = async () => {
    if (!businessId || !biz) return;
    setSaving(true);
    try {
      const { error } = await supabase.from("businesses").update({
        name: biz.name ?? "", phone: biz.phone ?? null, mpesa_type: biz.mpesa_type ?? null, mpesa_number: biz.mpesa_number ?? null,
        default_greeting: biz.default_greeting ?? null,
        business_hours: (biz.business_hours ?? null) as never,
        logo_url: biz.logo_url ?? null,
      }).eq("id", businessId);
      if (error) throw error;

      for (const provider of ["whatsapp", "africastalking", "mpesa"] as const) {
        const f = forms[provider];
        const hasPublic = Object.keys(f.public_fields).length > 0;
        const hasSecret = Object.values(f.secret_fields).some((v) => v && v.length > 0);
        const m = meta[provider];
        // Skip providers with no existing creds AND no input
        if (!m && !hasPublic && !hasSecret && !f.is_active) continue;
        await saveCreds({
          data: {
            provider,
            is_active: f.is_active,
            public_fields: f.public_fields,
            secret_fields: f.secret_fields,
          },
        });
      }
      // Refresh masked view, clear typed secrets
      const { creds } = await listCreds();
      const newMeta: Record<Provider, CredMeta | undefined> = {
        whatsapp: undefined, africastalking: undefined, mpesa: undefined,
      };
      const newForms: Record<Provider, Form> = {
        whatsapp: emptyForm(), africastalking: emptyForm(), mpesa: emptyForm(),
      };
      for (const c of creds) {
        newMeta[c.provider] = c;
        newForms[c.provider] = { is_active: c.is_active, public_fields: { ...c.public_fields }, secret_fields: {} };
      }
      setMeta(newMeta);
      setForms(newForms);
      await refreshBusiness();
      toast.success("Saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  if (!biz) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  const secretPlaceholder = (p: Provider, k: string) =>
    meta[p]?.secret_hints?.[k]
      ? `Stored — ${meta[p]?.secret_hints?.[k]} (leave blank to keep)`
      : "Not set";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="flex items-center gap-2 text-xl font-bold"><SettingsIcon className="h-5 w-5" /> Settings</h1>

      <section className="space-y-4 rounded-2xl border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-semibold">
              <Bot className="h-4 w-4" /> AI Assistant
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              When enabled, the AI automatically replies to incoming WhatsApp messages 24/7 using the business information below.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{ai?.enabled ? "On" : "Off"}</span>
            <Switch
              checked={Boolean(ai?.enabled)}
              disabled={!ai || savingAi}
              onCheckedChange={(v) => persistAi({ enabled: v })}
            />
          </div>
        </div>

        {ai && (
          <div className="space-y-3 border-t pt-4">
            <div className="text-xs font-medium text-muted-foreground">Business information the AI can read</div>

            <div>
              <Label>Business description / about</Label>
              <Textarea
                rows={3}
                placeholder="What your business does, who you serve, what makes you different…"
                value={ai.business_description ?? ""}
                onChange={(e) => updateAi({ business_description: e.target.value })}
              />
            </div>

            <div>
              <Label>Products &amp; services (with prices)</Label>
              <Textarea
                rows={5}
                placeholder={"e.g.\n- Haircut — KES 500\n- Beard trim — KES 200\n- Home delivery available within Nairobi"}
                value={ai.products_services ?? ""}
                onChange={(e) => updateAi({ products_services: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Contact info</Label>
                <Textarea
                  rows={2}
                  placeholder="Phone, WhatsApp, email"
                  value={ai.contact_info ?? ""}
                  onChange={(e) => updateAi({ contact_info: e.target.value })}
                />
              </div>
              <div>
                <Label>Address / location</Label>
                <Textarea
                  rows={2}
                  placeholder="Physical address, landmarks, city"
                  value={ai.address ?? ""}
                  onChange={(e) => updateAi({ address: e.target.value })}
                />
              </div>
              <div>
                <Label>Website / social links</Label>
                <Input
                  placeholder="https://…"
                  value={ai.website ?? ""}
                  onChange={(e) => updateAi({ website: e.target.value })}
                />
              </div>
              <div>
                <Label>Business hours</Label>
                <Input
                  placeholder="Mon–Sat 8am–6pm"
                  value={ai.hours ?? ""}
                  onChange={(e) => updateAi({ hours: e.target.value })}
                />
              </div>
            </div>

            <div>
              <Label>FAQs</Label>
              <Textarea
                rows={5}
                placeholder={"Q: Do you deliver?\nA: Yes, free delivery within town.\n\nQ: Payment methods?\nA: M-Pesa, cash on delivery."}
                value={ai.faqs ?? ""}
                onChange={(e) => updateAi({ faqs: e.target.value })}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Reply tone</Label>
                <select
                  className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                  value={ai.tone ?? "friendly"}
                  onChange={(e) => updateAi({ tone: e.target.value })}
                >
                  <option value="friendly">Friendly</option>
                  <option value="professional">Professional</option>
                  <option value="casual">Casual</option>
                  <option value="sales">Sales</option>
                </select>
              </div>
              <div>
                <Label>Fallback reply (when the answer isn&apos;t in the knowledge base)</Label>
                <Input
                  placeholder="Let me confirm that with the team and get back to you shortly."
                  value={ai.fallback_message ?? ""}
                  onChange={(e) => updateAi({ fallback_message: e.target.value })}
                />
              </div>
            </div>

            <div className="flex items-start justify-between gap-4 rounded-xl border bg-muted/30 p-3">
              <div>
                <div className="text-sm font-medium">Strict knowledge mode</div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  The AI answers only from your knowledge base and business info. If a fact isn&apos;t there,
                  it sends your fallback reply instead of guessing.
                </p>
              </div>
              <Switch
                checked={ai.strict_knowledge !== false}
                onCheckedChange={(v) => updateAi({ strict_knowledge: v })}
              />
            </div>

            <div>
              <Label>Custom instructions</Label>
              <Textarea
                rows={8}
                placeholder={"Tell the AI how to behave.\n\nExamples:\n- Always greet by name if you know it.\n- Ask for the customer's location before quoting delivery.\n- Never promise discounts; offer to connect them with sales.\n- If someone asks for the manager, take their name and say we'll call back."}
                value={ai.custom_instructions ?? ""}
                onChange={(e) => updateAi({ custom_instructions: e.target.value })}
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                {(ai.custom_instructions ?? "").length.toLocaleString()} / 20,000 characters
              </p>
            </div>

            <Button onClick={() => persistAi()} disabled={savingAi}>
              <CheckCircle2 className="mr-1 h-4 w-4" /> {savingAi ? "Saving…" : "Save AI settings"}
            </Button>
          </div>
        )}
      </section>

      <KnowledgeBaseSection />

      <GatewaySection />



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
        <p className="flex items-start gap-1 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0" />
          Secrets are stored server-side and never sent back to your browser. Leave a field blank to keep the current value.
        </p>
        <Input
          type="password"
          autoComplete="off"
          placeholder={secretPlaceholder("whatsapp", "access_token")}
          value={forms.whatsapp.secret_fields.access_token ?? ""}
          onChange={(e) => setSecret("whatsapp", "access_token", e.target.value)}
        />
        <Input
          placeholder="Phone Number ID"
          value={forms.whatsapp.public_fields.phone_number_id ?? ""}
          onChange={(e) => setPublic("whatsapp", "phone_number_id", e.target.value)}
        />
        <Input
          placeholder="WhatsApp Business Account ID (WABA ID)"
          value={forms.whatsapp.public_fields.waba_id ?? ""}
          onChange={(e) => setPublic("whatsapp", "waba_id", e.target.value)}
        />

        <Input
          type="password"
          autoComplete="off"
          placeholder={secretPlaceholder("whatsapp", "verify_token") || "Webhook verify token (optional)"}
          value={forms.whatsapp.secret_fields.verify_token ?? ""}
          onChange={(e) => setSecret("whatsapp", "verify_token", e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={forms.whatsapp.is_active} onChange={(e) => setActive("whatsapp", e.target.checked)} /> Active
        </label>
      </section>

      <section className="space-y-3 rounded-2xl border bg-card p-5">
        <h2 className="font-semibold flex items-center gap-2"><Phone className="h-4 w-4" /> Africa's Talking SMS</h2>
        <Input
          type="password"
          autoComplete="off"
          placeholder={secretPlaceholder("africastalking", "api_key")}
          value={forms.africastalking.secret_fields.api_key ?? ""}
          onChange={(e) => setSecret("africastalking", "api_key", e.target.value)}
        />
        <Input
          placeholder="Username"
          value={forms.africastalking.public_fields.username ?? ""}
          onChange={(e) => setPublic("africastalking", "username", e.target.value)}
        />
        <Input
          placeholder="Sender ID (optional)"
          value={forms.africastalking.public_fields.sender_id ?? ""}
          onChange={(e) => setPublic("africastalking", "sender_id", e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={forms.africastalking.is_active} onChange={(e) => setActive("africastalking", e.target.checked)} /> Active
        </label>
      </section>

      <Button onClick={save} disabled={saving}><CheckCircle2 className="mr-1 h-4 w-4" /> Save changes</Button>
    </div>
  );
}
