import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { CheckCircle2, Upload, MessageCircle, Phone, Users } from "lucide-react";

export const Route = createFileRoute("/app/onboarding")({
  component: OnboardingPage,
});

type Step = 1 | 2 | 3 | 4;
const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
type Day = typeof DAYS[number];
type Hours = Record<Day, { open: string; close: string; closed: boolean }>;

const DEFAULT_HOURS: Hours = {
  mon: { open: "09:00", close: "17:00", closed: false },
  tue: { open: "09:00", close: "17:00", closed: false },
  wed: { open: "09:00", close: "17:00", closed: false },
  thu: { open: "09:00", close: "17:00", closed: false },
  fri: { open: "09:00", close: "17:00", closed: false },
  sat: { open: "09:00", close: "13:00", closed: false },
  sun: { open: "09:00", close: "13:00", closed: true },
};

function OnboardingPage() {
  const { user, businessId, business, refreshBusiness } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(1);
  const [saving, setSaving] = useState(false);

  // Step 1 — profile
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("Hi 👋 thanks for reaching out! How can we help?");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [hours, setHours] = useState<Hours>(DEFAULT_HOURS);

  // Step 2 — phone + M-Pesa
  const [phone, setPhone] = useState("");
  const [mpesaType, setMpesaType] = useState<"paybill" | "till" | "phone">("phone");
  const [mpesaNumber, setMpesaNumber] = useState("");

  // Step 3 — channels (optional creds)
  const [waToken, setWaToken] = useState("");
  const [waPhoneId, setWaPhoneId] = useState("");
  const [atApiKey, setAtApiKey] = useState("");
  const [atUsername, setAtUsername] = useState("");
  const [atSenderId, setAtSenderId] = useState("");

  // Step 4 — contacts
  const [contactsText, setContactsText] = useState("");

  useEffect(() => {
    if (business) setName(business.name);
  }, [business]);

  const saveProfile = async () => {
    if (!businessId || !user) return;
    setSaving(true);
    try {
      let logoUrl: string | undefined;
      if (logoFile) {
        const path = `${businessId}/logo-${Date.now()}-${logoFile.name}`;
        const up = await supabase.storage.from("business-assets").upload(path, logoFile, { upsert: true });
        if (up.error) throw up.error;
        const { data } = supabase.storage.from("business-assets").getPublicUrl(path);
        logoUrl = data.publicUrl;
      }
      const { error } = await supabase
        .from("businesses")
        .update({
          name,
          default_greeting: greeting,
          business_hours: hours,
          ...(logoUrl ? { logo_url: logoUrl } : {}),
        })
        .eq("id", businessId);
      if (error) throw error;
      await refreshBusiness();
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const savePhone = async () => {
    if (!businessId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("businesses")
        .update({ phone, mpesa_type: mpesaType, mpesa_number: mpesaNumber })
        .eq("id", businessId);
      if (error) throw error;
      setStep(3);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const saveChannels = async () => {
    if (!businessId) return;
    setSaving(true);
    try {
      if (waToken || waPhoneId) {
        await supabase.from("channel_credentials").upsert({
          business_id: businessId,
          provider: "whatsapp",
          credentials: { access_token: waToken, phone_number_id: waPhoneId },
          is_active: !!(waToken && waPhoneId),
        }, { onConflict: "business_id,provider" });
      }
      if (atApiKey || atUsername) {
        await supabase.from("channel_credentials").upsert({
          business_id: businessId,
          provider: "africastalking",
          credentials: { api_key: atApiKey, username: atUsername, sender_id: atSenderId },
          is_active: !!(atApiKey && atUsername),
        }, { onConflict: "business_id,provider" });
      }
      setStep(4);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    if (!businessId) return;
    setSaving(true);
    try {
      // Import contacts (CSV: name,phone per line)
      const rows = contactsText
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          const [n, p] = l.split(/[,\t]/).map((s) => s?.trim());
          return n && p ? { business_id: businessId, name: n, phone: p } : null;
        })
        .filter((r): r is NonNullable<typeof r> => !!r);
      if (rows.length > 0) {
        const { error } = await supabase.from("contacts").insert(rows);
        if (error) toast.error(`Some contacts failed: ${error.message}`);
        else toast.success(`Imported ${rows.length} contacts`);
      }
      const { error } = await supabase
        .from("businesses")
        .update({ onboarded_at: new Date().toISOString() })
        .eq("id", businessId);
      if (error) throw error;
      await refreshBusiness();
      toast.success("You're all set!");
      navigate({ to: "/app/conversations" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 flex items-center gap-2">
        {[1, 2, 3, 4].map((s) => (
          <div key={s} className={`h-1.5 flex-1 rounded-full ${s <= step ? "bg-primary" : "bg-muted"}`} />
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4 rounded-2xl border bg-card p-6">
          <div>
            <h1 className="text-xl font-bold">Set up your business</h1>
            <p className="text-sm text-muted-foreground">Name, logo, greeting, and hours.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Business name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Shop" />
          </div>
          <div className="space-y-1.5">
            <Label className="flex items-center gap-2"><Upload className="h-4 w-4" /> Logo (optional)</Label>
            <Input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-1.5">
            <Label>Default greeting</Label>
            <Textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={2} />
          </div>
          <div className="space-y-2">
            <Label>Business hours</Label>
            <div className="space-y-1.5 rounded-lg border p-3 text-sm">
              {DAYS.map((d) => (
                <div key={d} className="flex items-center gap-2">
                  <span className="w-10 capitalize">{d}</span>
                  <label className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={!hours[d].closed}
                      onChange={(e) => setHours({ ...hours, [d]: { ...hours[d], closed: !e.target.checked } })}
                    />
                    Open
                  </label>
                  <Input type="time" disabled={hours[d].closed} value={hours[d].open}
                    onChange={(e) => setHours({ ...hours, [d]: { ...hours[d], open: e.target.value } })} className="h-8" />
                  <Input type="time" disabled={hours[d].closed} value={hours[d].close}
                    onChange={(e) => setHours({ ...hours, [d]: { ...hours[d], close: e.target.value } })} className="h-8" />
                </div>
              ))}
            </div>
          </div>
          <Button onClick={saveProfile} disabled={saving || !name} className="w-full">Continue</Button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4 rounded-2xl border bg-card p-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2"><Phone className="h-5 w-5" /> Phone & M-Pesa</h1>
            <p className="text-sm text-muted-foreground">Customers will use this to pay you.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Business phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2547XXXXXXXX" />
          </div>
          <div className="space-y-1.5">
            <Label>M-Pesa type</Label>
            <div className="flex gap-2">
              {(["phone", "till", "paybill"] as const).map((t) => (
                <button key={t} type="button" onClick={() => setMpesaType(t)}
                  className={`flex-1 rounded-md border px-3 py-2 text-sm capitalize ${mpesaType === t ? "border-primary bg-primary/10" : ""}`}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>{mpesaType === "paybill" ? "Paybill + account" : mpesaType === "till" ? "Till number" : "M-Pesa phone"}</Label>
            <Input value={mpesaNumber} onChange={(e) => setMpesaNumber(e.target.value)} placeholder={mpesaType === "paybill" ? "247247 / 12345" : "0712345678"} />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(1)} className="flex-1">Back</Button>
            <Button onClick={savePhone} disabled={saving} className="flex-1">Continue</Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4 rounded-2xl border bg-card p-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2"><MessageCircle className="h-5 w-5" /> Connect channels</h1>
            <p className="text-sm text-muted-foreground">Add your WhatsApp Business API and Africa's Talking SMS credentials. You can skip and add them later from Settings.</p>
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-semibold">WhatsApp Business API</p>
            <Input value={waToken} onChange={(e) => setWaToken(e.target.value)} placeholder="Access token" />
            <Input value={waPhoneId} onChange={(e) => setWaPhoneId(e.target.value)} placeholder="Phone Number ID" />
          </div>
          <div className="rounded-lg border p-3 space-y-2">
            <p className="text-sm font-semibold">Africa's Talking SMS</p>
            <Input value={atApiKey} onChange={(e) => setAtApiKey(e.target.value)} placeholder="API key" />
            <Input value={atUsername} onChange={(e) => setAtUsername(e.target.value)} placeholder="Username" />
            <Input value={atSenderId} onChange={(e) => setAtSenderId(e.target.value)} placeholder="Sender ID (optional)" />
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(2)} className="flex-1">Back</Button>
            <Button variant="ghost" onClick={() => setStep(4)} className="flex-1">Skip</Button>
            <Button onClick={saveChannels} disabled={saving} className="flex-1">Save</Button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4 rounded-2xl border bg-card p-6">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2"><Users className="h-5 w-5" /> Import contacts</h1>
            <p className="text-sm text-muted-foreground">Paste contacts one per line as <code>Name, Phone</code>. Skip if you'll add them later.</p>
          </div>
          <Textarea rows={8} value={contactsText} onChange={(e) => setContactsText(e.target.value)}
            placeholder={"Jane Doe, +254712345678\nJohn Mwangi, +254700000000"} />
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setStep(3)} className="flex-1">Back</Button>
            <Button onClick={finish} disabled={saving} className="flex-1">
              <CheckCircle2 className="mr-1 h-4 w-4" />
              {contactsText.trim() ? "Import & finish" : "Finish"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
