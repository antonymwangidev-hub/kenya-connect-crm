import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decryptSecret, encryptFields, encryptSecret } from "@/lib/crypto.server";
import { writeAudit } from "@/lib/audit.server";

const providerSchema = z.enum(["whatsapp", "africastalking", "mpesa"]);

type ProviderName = z.infer<typeof providerSchema>;

type CredMeta = {
  provider: ProviderName;
  is_active: boolean;
  has_secrets: boolean;
  // Non-secret fields safe to render in UI
  public_fields: Record<string, string>;
  // Per-secret-field indicator + masked hint (last 4 chars)
  secret_hints: Record<string, string>;
};

// Whitelist of fields safe to send to the browser (non-secret)
const PUBLIC_FIELDS: Record<ProviderName, string[]> = {
  whatsapp: ["phone_number_id", "waba_id"],
  africastalking: ["username", "sender_id"],
  mpesa: ["shortcode", "till", "paybill"],
};


const SECRET_FIELDS: Record<ProviderName, string[]> = {
  whatsapp: ["access_token", "verify_token", "app_secret"],
  africastalking: ["api_key"],
  mpesa: ["consumer_key", "consumer_secret", "passkey"],
};

function maskTail(value: string): string {
  if (!value) return "";
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

export const listChannelCredentials = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ creds: CredMeta[] }> => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("channel_credentials")
      .select("provider, is_active, credentials");
    if (error) throw new Error(error.message);

    const creds: CredMeta[] = [];
    for (const row of data ?? []) {
      const provider = row.provider as ProviderName;
      const raw = (row.credentials ?? {}) as Record<string, string>;
      const publicFields: Record<string, string> = {};
      for (const k of PUBLIC_FIELDS[provider] ?? []) {
        if (raw[k]) publicFields[k] = String(raw[k]);
      }
      const secretHints: Record<string, string> = {};
      let hasSecrets = false;
      for (const k of SECRET_FIELDS[provider] ?? []) {
        if (raw[k]) {
          hasSecrets = true;
          secretHints[k] = maskTail((await decryptSecret(String(raw[k]))) ?? "");
        }
      }
      creds.push({
        provider,
        is_active: !!row.is_active,
        has_secrets: hasSecrets,
        public_fields: publicFields,
        secret_hints: secretHints,
      });
    }
    return { creds };
  });

export const upsertChannelCredentials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        provider: providerSchema,
        is_active: z.boolean().optional(),
        // Public (non-secret) fields, e.g. phone_number_id, username
        public_fields: z.record(z.string().max(500)).optional(),
        // Secret fields. Empty/undefined values are NOT overwritten — keeps existing value.
        secret_fields: z.record(z.string().max(4000)).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: biz, error: bizErr } = await supabase
      .from("businesses")
      .select("id")
      .limit(1)
      .single();
    if (bizErr || !biz) throw new Error("Business not found");

    // Read existing creds (RLS scopes to owner)
    const { data: existing } = await supabase
      .from("channel_credentials")
      .select("credentials, is_active")
      .eq("business_id", biz.id)
      .eq("provider", data.provider)
      .maybeSingle();

    const merged: Record<string, string> = {
      ...((existing?.credentials as Record<string, string> | null) ?? {}),
    };

    // Public fields: always overwrite (including clearing if empty)
    for (const k of PUBLIC_FIELDS[data.provider] ?? []) {
      if (data.public_fields && k in data.public_fields) {
        const v = data.public_fields[k];
        if (v && v.length > 0) merged[k] = v;
        else delete merged[k];
      }
    }

    // Secret fields: only overwrite when a non-empty value is provided
    for (const k of SECRET_FIELDS[data.provider] ?? []) {
      const v = data.secret_fields?.[k];
      if (typeof v === "string" && v.length > 0) merged[k] = v;
    }

    const stored = await encryptFields(merged, SECRET_FIELDS[data.provider] ?? []);

    const { error } = await supabase
      .from("channel_credentials")
      .upsert(
        {
          business_id: biz.id,
          provider: data.provider,
          credentials: stored,
          is_active: data.is_active ?? existing?.is_active ?? false,
        },
        { onConflict: "business_id,provider" },
      );
    if (error) throw new Error(error.message);

    // For WhatsApp: keep whatsapp_business_accounts in sync so the manually
    // configured account also appears in Templates and multi-account UIs.
    if (data.provider === "whatsapp") {
      const wabaId = (merged.waba_id ?? "").trim();
      const phoneNumberId = (merged.phone_number_id ?? "").trim();
      const accessToken = (merged.access_token ?? "").trim();
      if (wabaId && phoneNumberId) {
        const { data: bizRow } = await supabase
          .from("businesses").select("name").eq("id", biz.id).maybeSingle();
        await supabase.from("whatsapp_business_accounts").upsert(
          {
            business_id: biz.id,
            waba_id: wabaId,
            phone_number_id: phoneNumberId,
            business_name: (bizRow?.name as string | undefined) ?? "WhatsApp Business",
            access_token: accessToken ? await encryptSecret(accessToken) : null,
            status: data.is_active === false ? "disabled" : "connected",
            meta: { source: "manual_settings" } as never,
          },
          { onConflict: "business_id,waba_id,phone_number_id" },
        );
      }
    }
    await writeAudit({
      businessId: biz.id,
      actorId: context.userId,
      action: "channel_credentials.updated",
      targetType: "channel_credentials",
      targetId: data.provider,
      detail: {
        provider: data.provider,
        is_active: data.is_active ?? existing?.is_active ?? false,
        secrets_changed: Object.keys(data.secret_fields ?? {}).filter(
          (k) => (data.secret_fields?.[k] ?? "").length > 0,
        ),
      },
    });
    return { ok: true };
  });
