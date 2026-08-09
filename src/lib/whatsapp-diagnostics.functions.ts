import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { decryptSecret } from "@/lib/crypto.server";

const GRAPH_VERSION = "v21.0";

type WabaAccount = {
  id: string;
  business_name: string | null;
  waba_id: string | null;
  phone_number_id: string | null;
  phone_number: string | null;
  status: string | null;
  source: "whatsapp_business_accounts" | "whatsapp_connections";
};

async function resolveTokenForWaba(
  supabase: Awaited<ReturnType<typeof getSbAdmin>>,
  wabaId: string | null,
  phoneNumberId: string | null,
): Promise<string | null> {
  if (wabaId) {
    const { data: acc } = await supabase
      .from("whatsapp_business_accounts")
      .select("access_token")
      .eq("waba_id", wabaId)
      .maybeSingle();
    const t = (await decryptSecret(acc?.access_token))?.trim();
    if (t) return t;
  }
  if (phoneNumberId) {
    const { data: conn } = await supabase
      .from("whatsapp_connections")
      .select("meta")
      .eq("phone_number_id", phoneNumberId)
      .neq("status", "disconnected")
      .maybeSingle();
    const meta = (conn?.meta ?? {}) as Record<string, string>;
    const connTok = await decryptSecret(meta.access_token);
    if (connTok) return connTok;
  }
  return process.env.WHATSAPP_ACCESS_TOKEN?.trim() ?? null;
}

async function getSbAdmin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Verify the signed-in user owns a business that is linked to the given WABA
 * (and phone number id, when supplied). Throws when the caller does not.
 */
async function assertOwnsWaba(
  supabase: Awaited<ReturnType<typeof getSbAdmin>>,
  userId: string,
  wabaId: string,
  phoneNumberId: string | null,
): Promise<void> {
  const { data: businesses } = await supabase
    .from("businesses")
    .select("id")
    .eq("owner_id", userId);
  const businessIds = (businesses ?? []).map((b) => b.id);
  if (businessIds.length === 0) throw new Error("Forbidden: WhatsApp account not found");

  let accQuery = supabase
    .from("whatsapp_business_accounts")
    .select("id")
    .in("business_id", businessIds)
    .eq("waba_id", wabaId);
  if (phoneNumberId) accQuery = accQuery.eq("phone_number_id", phoneNumberId);
  const { data: acc } = await accQuery.limit(1).maybeSingle();
  if (acc) return;

  let connQuery = supabase
    .from("whatsapp_connections")
    .select("id")
    .in("business_id", businessIds)
    .eq("waba_id", wabaId)
    .neq("status", "disconnected");
  if (phoneNumberId) connQuery = connQuery.eq("phone_number_id", phoneNumberId);
  const { data: conn } = await connQuery.limit(1).maybeSingle();
  if (conn) return;

  throw new Error("Forbidden: WhatsApp account not found");
}

export const listWhatsappAccountsForDiagnostics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const supabase = await getSbAdmin();

    // Businesses the caller owns
    const { data: businesses } = await supabase
      .from("businesses")
      .select("id")
      .eq("owner_id", context.userId);
    const businessIds = (businesses ?? []).map((b) => b.id);
    if (businessIds.length === 0) return { accounts: [] as WabaAccount[] };

    const [{ data: accs }, { data: conns }] = await Promise.all([
      supabase
        .from("whatsapp_business_accounts")
        .select("id,business_name,waba_id,phone_number_id,status")
        .in("business_id", businessIds),
      supabase
        .from("whatsapp_connections")
        .select("id,phone_number,phone_number_id,waba_id,display_name,status")
        .in("business_id", businessIds)
        .neq("status", "disconnected"),
    ]);

    const accounts: WabaAccount[] = [];
    for (const a of accs ?? []) {
      accounts.push({
        id: a.id,
        business_name: a.business_name,
        waba_id: a.waba_id,
        phone_number_id: a.phone_number_id,
        phone_number: null,
        status: a.status,
        source: "whatsapp_business_accounts",
      });
    }
    for (const c of conns ?? []) {
      // Skip if already represented by an account row with same waba+pnid
      const dupe = accounts.find(
        (x) => x.waba_id === c.waba_id && x.phone_number_id === c.phone_number_id,
      );
      if (dupe) {
        if (!dupe.phone_number) dupe.phone_number = c.phone_number;
        continue;
      }
      accounts.push({
        id: c.id,
        business_name: c.display_name,
        waba_id: c.waba_id,
        phone_number_id: c.phone_number_id,
        phone_number: c.phone_number,
        status: c.status,
        source: "whatsapp_connections",
      });
    }
    return { accounts };
  });

export const checkWhatsappSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        wabaId: z.string().min(1),
        phoneNumberId: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = await getSbAdmin();
    await assertOwnsWaba(supabase, context.userId, data.wabaId, data.phoneNumberId ?? null);
    const token = await resolveTokenForWaba(supabase, data.wabaId, data.phoneNumberId ?? null);
    if (!token) {
      return { ok: false as const, subscribed: false, error: "No access token found for this WABA" };
    }
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${data.wabaId}/subscribed_apps`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const text = await res.text();
    if (!res.ok) {
      return { ok: false as const, subscribed: false, status: res.status, error: text.slice(0, 400) };
    }
    let parsed: { data?: Array<{ whatsapp_business_api_data?: { name?: string; id?: string } }> } = {};
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    const apps = parsed.data ?? [];
    return {
      ok: true as const,
      subscribed: apps.length > 0,
      apps: apps.map((a) => ({
        id: a.whatsapp_business_api_data?.id ?? null,
        name: a.whatsapp_business_api_data?.name ?? null,
      })),
    };
  });

export const resubscribeWhatsappWebhook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        wabaId: z.string().min(1),
        phoneNumberId: z.string().nullable().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = await getSbAdmin();
    await assertOwnsWaba(supabase, context.userId, data.wabaId, data.phoneNumberId ?? null);
    const token = await resolveTokenForWaba(supabase, data.wabaId, data.phoneNumberId ?? null);
    if (!token) {
      return { ok: false as const, error: "No access token found for this WABA" };
    }
    const res = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${data.wabaId}/subscribed_apps`,
      { method: "POST", headers: { Authorization: `Bearer ${token}` } },
    );
    const text = await res.text();
    if (!res.ok) {
      return { ok: false as const, status: res.status, error: text.slice(0, 400) };
    }
    return { ok: true as const, response: text.slice(0, 400) };
  });
