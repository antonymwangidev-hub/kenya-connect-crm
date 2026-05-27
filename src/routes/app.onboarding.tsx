import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import {
  CheckCircle2,
  Upload,
  MessageCircle,
  Phone,
  ShieldCheck,
  Store,
  Smartphone,
  PartyPopper,
  ArrowLeft,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import {
  startWhatsappConnection,
  completeWhatsappConnection,
  getEmbeddedSignupConfig,
} from "@/lib/whatsapp.functions";
import { submitVerification } from "@/lib/verification.functions";
import {
  listAvailableNumbers,
  reserveAndPayForNumber,
  confirmNumberPurchase,
} from "@/lib/virtual-numbers.functions";

export const Route = createFileRoute("/app/onboarding")({
  component: OnboardingPage,
});

const STEPS = ["Business", "Verify", "Connect WhatsApp", "Done"] as const;

function OnboardingPage() {
  const { businessId, business, refreshBusiness } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  // Step 1 — business profile
  const [name, setName] = useState("");
  const [greeting, setGreeting] = useState("Hi 👋 thanks for messaging us! How can we help today?");
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);

  // Step 2 — verification
  const [legalName, setLegalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [certUrl, setCertUrl] = useState<string | null>(null);
  const [idUrl, setIdUrl] = useState<string | null>(null);

  // Step 3 — WhatsApp connection path
  const [path, setPath] = useState<"existing" | "new_number" | null>(null);

  useEffect(() => {
    if (business) {
      setName(business.name);
      setLegalName(business.name);
      setDisplayName(business.name);
    }
  }, [business]);

  const progress = ((step + 1) / STEPS.length) * 100;

  const uploadTo = async (file: File, kind: string) => {
    if (!businessId) return null;
    const path = `${businessId}/${kind}-${Date.now()}-${file.name}`;
    const up = await supabase.storage.from("business-assets").upload(path, file, { upsert: true });
    if (up.error) throw up.error;
    const { data } = supabase.storage.from("business-assets").getPublicUrl(path);
    return data.publicUrl;
  };

  const saveProfile = async () => {
    if (!businessId) return;
    setSaving(true);
    try {
      let logoUrl: string | undefined;
      if (logoFile) {
        const url = await uploadTo(logoFile, "logo");
        if (url) logoUrl = url;
      }
      const { error } = await supabase
        .from("businesses")
        .update({
          name,
          default_greeting: greeting,
          ...(logoUrl ? { logo_url: logoUrl } : {}),
        })
        .eq("id", businessId);
      if (error) throw error;
      await refreshBusiness();
      setStep(1);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const submitVerificationFn = useServerFn(submitVerification);
  const handleVerification = async () => {
    setSaving(true);
    try {
      await submitVerificationFn({
        data: {
          legalName,
          suggestedDisplayName: displayName,
          certificateUrl: certUrl,
          ownerIdUrl: idUrl,
        },
      });
      setStep(2);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const finish = async () => {
    if (!businessId) return;
    await supabase
      .from("businesses")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", businessId);
    await refreshBusiness();
    navigate({ to: "/app/conversations" });
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col px-4 py-6">
      <div className="mb-6 space-y-2">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Step {step + 1} of {STEPS.length}</span>
          <span>{STEPS[step]}</span>
        </div>
        <Progress value={progress} />
      </div>

      {step === 0 && (
        <Card title="Tell us about your business" icon={Store} subtitle="Your customers will see this on WhatsApp.">
          <Field label="Business name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Mama Mboga Fresh" />
          </Field>
          <Field label="Logo (optional)" icon={Upload}>
            <Input type="file" accept="image/*" onChange={(e) => setLogoFile(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Welcome message">
            <Textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} rows={3} />
            <p className="mt-1 text-xs text-muted-foreground">Sent to new customers automatically.</p>
          </Field>
          <PrimaryButton onClick={saveProfile} disabled={!name || saving}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Continue
          </PrimaryButton>
        </Card>
      )}

      {step === 1 && (
        <VerificationStep
          legalName={legalName}
          setLegalName={setLegalName}
          displayName={displayName}
          setDisplayName={setDisplayName}
          onCertUpload={async (f) => setCertUrl(await uploadTo(f, "cert"))}
          onIdUpload={async (f) => setIdUrl(await uploadTo(f, "id"))}
          certUrl={certUrl}
          idUrl={idUrl}
          onBack={() => setStep(0)}
          onContinue={handleVerification}
          saving={saving}
        />
      )}

      {step === 2 && (
        <ConnectStep
          path={path}
          setPath={setPath}
          onBack={() => setStep(1)}
          onConnected={() => setStep(3)}
          businessName={name}
          displayName={displayName}
        />
      )}

      {step === 3 && (
        <Card title="You're all set!" icon={PartyPopper} subtitle="Start replying to your customers from one inbox.">
          <ul className="space-y-2 text-sm">
            <ChecklistItem text="Business profile saved" />
            <ChecklistItem text="Verification submitted" />
            <ChecklistItem text="WhatsApp connection started" />
          </ul>
          <PrimaryButton onClick={finish}>
            Open my inbox
          </PrimaryButton>
        </Card>
      )}
    </div>
  );
}

// ─── Step components ────────────────────────────────────────────────────────

function VerificationStep(props: {
  legalName: string;
  setLegalName: (v: string) => void;
  displayName: string;
  setDisplayName: (v: string) => void;
  certUrl: string | null;
  idUrl: string | null;
  onCertUpload: (f: File) => Promise<void>;
  onIdUpload: (f: File) => Promise<void>;
  onBack: () => void;
  onContinue: () => void;
  saving: boolean;
}) {
  const nameWarning = useMemo(() => {
    if (!props.legalName || !props.displayName) return null;
    const a = props.legalName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const b = props.displayName.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const shared = a.some((w) => b.includes(w));
    if (!shared) return "Your display name doesn't match your business name. WhatsApp may reject this.";
    return null;
  }, [props.legalName, props.displayName]);

  return (
    <Card
      title="Verify your business"
      icon={ShieldCheck}
      subtitle="A quick step so WhatsApp trusts your number."
    >
      <Field label="Registered business name">
        <Input value={props.legalName} onChange={(e) => props.setLegalName(e.target.value)} />
      </Field>
      <Field label="Display name on WhatsApp">
        <Input value={props.displayName} onChange={(e) => props.setDisplayName(e.target.value)} />
        {nameWarning && (
          <p className="mt-1 flex items-start gap-1 text-xs text-amber-600">
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
            {nameWarning}
          </p>
        )}
      </Field>
      <Field label="Business certificate (optional)" icon={Upload}>
        <Input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void props.onCertUpload(f).then(() => toast.success("Uploaded"));
          }}
        />
        {props.certUrl && <p className="mt-1 text-xs text-emerald-600">✓ Uploaded</p>}
      </Field>
      <Field label="Owner ID (optional)" icon={Upload}>
        <Input
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void props.onIdUpload(f).then(() => toast.success("Uploaded"));
          }}
        />
        {props.idUrl && <p className="mt-1 text-xs text-emerald-600">✓ Uploaded</p>}
      </Field>
      <ButtonRow onBack={props.onBack}>
        <PrimaryButton onClick={props.onContinue} disabled={props.saving || !props.legalName || !props.displayName}>
          Continue
        </PrimaryButton>
      </ButtonRow>
    </Card>
  );
}

function ConnectStep(props: {
  path: "existing" | "new_number" | null;
  setPath: (p: "existing" | "new_number" | null) => void;
  onBack: () => void;
  onConnected: () => void;
  businessName: string;
  displayName: string;
}) {
  if (props.path === "existing") {
    return <UseExistingFlow displayName={props.displayName} onBack={() => props.setPath(null)} onDone={props.onConnected} />;
  }
  if (props.path === "new_number") {
    return <BuyNumberFlow displayName={props.displayName} onBack={() => props.setPath(null)} onDone={props.onConnected} />;
  }
  return (
    <Card title="Connect WhatsApp" icon={MessageCircle} subtitle="Choose how you want to reply to your customers.">
      <button
        type="button"
        onClick={() => props.setPath("existing")}
        className="w-full rounded-xl border bg-card p-4 text-left transition hover:border-primary hover:bg-primary/5"
      >
        <div className="flex items-start gap-3">
          <Smartphone className="h-5 w-5 text-primary" />
          <div>
            <p className="font-semibold">Use my current WhatsApp number</p>
            <p className="text-sm text-muted-foreground">
              Reply from this dashboard. Your WhatsApp app on this phone will sign out.
            </p>
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={() => props.setPath("new_number")}
        className="w-full rounded-xl border bg-card p-4 text-left transition hover:border-primary hover:bg-primary/5"
      >
        <div className="flex items-start gap-3">
          <Phone className="h-5 w-5 text-primary" />
          <div>
            <p className="font-semibold">Get a new business number</p>
            <p className="text-sm text-muted-foreground">
              Buy a fresh 07XX number for KES 550. Keep your personal WhatsApp untouched.
            </p>
          </div>
        </div>
      </button>
      <ButtonRow onBack={props.onBack} />
    </Card>
  );
}

function UseExistingFlow({
  displayName,
  onBack,
  onDone,
}: {
  displayName: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const start = useServerFn(startWhatsappConnection);
  const complete = useServerFn(completeWhatsappConnection);
  const cfg = useServerFn(getEmbeddedSignupConfig);

  const connect = async () => {
    setBusy(true);
    try {
      const { ready } = await cfg();
      const { connection } = await start({
        data: { phoneNumber: phone, displayName, path: "existing" },
      });
      if (ready) {
        // Real embedded-signup flow would open Meta's popup here.
        toast.message("Opening WhatsApp sign-up…", {
          description: "Follow the prompts in the popup window.",
        });
      } else {
        toast.message("Connection reserved", {
          description: "We'll finish linking your number as soon as WhatsApp approves it.",
        });
      }
      await complete({ data: { connectionId: connection.id } });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card
      title="Use your WhatsApp number"
      icon={Smartphone}
      subtitle="Reply to customers from this dashboard."
    >
      <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="mb-2 flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4" /> Important
        </p>
        <p>
          Your WhatsApp app will sign out on this phone once connected. You'll reply to customers from
          here instead. Existing chats may disappear — back them up first if needed.
        </p>
        <label className="mt-3 flex items-start gap-2">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5"
          />
          <span>I understand and want to continue.</span>
        </label>
      </div>
      <Field label="Your WhatsApp number">
        <Input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+2547XXXXXXXX"
          inputMode="tel"
        />
      </Field>
      <ButtonRow onBack={onBack}>
        <PrimaryButton onClick={connect} disabled={!acknowledged || phone.length < 9 || busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Connect WhatsApp
        </PrimaryButton>
      </ButtonRow>
    </Card>
  );
}

function BuyNumberFlow({
  displayName,
  onBack,
  onDone,
}: {
  displayName: string;
  onBack: () => void;
  onDone: () => void;
}) {
  type Num = { id: string; phone_number: string; price_kes: number };
  const list = useServerFn(listAvailableNumbers);
  const reserve = useServerFn(reserveAndPayForNumber);
  const confirm = useServerFn(confirmNumberPurchase);
  const start = useServerFn(startWhatsappConnection);
  const complete = useServerFn(completeWhatsappConnection);

  const [numbers, setNumbers] = useState<Num[]>([]);
  const [selected, setSelected] = useState<Num | null>(null);
  const [mpesa, setMpesa] = useState("");
  const [stage, setStage] = useState<"pick" | "pay" | "connecting">("pick");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void list().then(({ numbers }) => setNumbers((numbers as Num[]) ?? []));
  }, [list]);

  const startPayment = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const { transaction } = await reserve({
        data: { numberId: selected.id, mpesaPhone: mpesa },
      });
      toast.message("M-Pesa prompt sent", {
        description: `Check your phone (${mpesa}) and enter your PIN to pay KES ${selected.price_kes}.`,
      });
      // In production we'd poll status. For now confirm after a short pause.
      await new Promise((r) => setTimeout(r, 1500));
      await confirm({ data: { transactionId: transaction.id } });
      setStage("connecting");
      const { connection } = await start({
        data: { phoneNumber: selected.phone_number, displayName, path: "new_number" },
      });
      await complete({ data: { connectionId: connection.id } });
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Payment failed");
    } finally {
      setBusy(false);
    }
  };

  if (stage === "connecting") {
    return (
      <Card title="Connecting your number" icon={MessageCircle} subtitle="This only takes a moment.">
        <div className="grid place-items-center py-8">
          <Loader2 className="h-10 w-10 animate-spin text-primary" />
        </div>
      </Card>
    );
  }

  if (stage === "pay" && selected) {
    return (
      <Card title="Pay with M-Pesa" icon={Phone} subtitle={`Number: ${selected.phone_number} • KES ${selected.price_kes}`}>
        <Field label="M-Pesa phone number">
          <Input
            value={mpesa}
            onChange={(e) => setMpesa(e.target.value)}
            placeholder="07XXXXXXXX"
            inputMode="tel"
          />
        </Field>
        <ButtonRow onBack={() => setStage("pick")}>
          <PrimaryButton onClick={startPayment} disabled={busy || mpesa.length < 9}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Send M-Pesa prompt
          </PrimaryButton>
        </ButtonRow>
      </Card>
    );
  }

  return (
    <Card title="Pick a business number" icon={Phone} subtitle="Kenyan 07XX numbers. KES 550 one-time.">
      {numbers.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading numbers…</p>
      ) : (
        <div className="space-y-2">
          {numbers.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => setSelected(n)}
              className={`flex w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                selected?.id === n.id ? "border-primary bg-primary/5" : "hover:border-primary/40"
              }`}
            >
              <span className="font-medium">{n.phone_number}</span>
              <span className="text-sm text-muted-foreground">KES {n.price_kes}</span>
            </button>
          ))}
        </div>
      )}
      <ButtonRow onBack={onBack}>
        <PrimaryButton onClick={() => setStage("pay")} disabled={!selected}>
          Continue
        </PrimaryButton>
      </ButtonRow>
    </Card>
  );
}

// ─── Primitives ─────────────────────────────────────────────────────────────

function Card(props: {
  title: string;
  subtitle?: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold leading-tight">{props.title}</h1>
          {props.subtitle && <p className="text-sm text-muted-foreground">{props.subtitle}</p>}
        </div>
      </div>
      {props.children}
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5 text-sm">
        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {label}
      </Label>
      {children}
    </div>
  );
}

function PrimaryButton(props: React.ComponentProps<typeof Button>) {
  return <Button {...props} className="h-12 w-full text-base" />;
}

function ButtonRow({ onBack, children }: { onBack: () => void; children?: React.ReactNode }) {
  return (
    <div className="flex gap-2 pt-2">
      <Button variant="outline" onClick={onBack} className="h-12">
        <ArrowLeft className="mr-1 h-4 w-4" /> Back
      </Button>
      <div className="flex-1">{children}</div>
    </div>
  );
}

function ChecklistItem({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-2">
      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      {text}
    </li>
  );
}
