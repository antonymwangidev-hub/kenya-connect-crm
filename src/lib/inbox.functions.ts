import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------------------------------------------------------------------------
// Team management for the shared inbox. Invites need a privileged lookup of
// the auth user id by email, so they run server-side; everything else (claim,
// status, labels, notes) is done straight from the client under RLS.
// ---------------------------------------------------------------------------

async function assertOwner(supabase: NonNullable<Awaited<ReturnType<typeof getCtx>>>, businessId: string) {
  const { data, error } = await supabase
    .from("businesses")
    .select("id,owner_id")
    .eq("id", businessId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Business not found");
  return data;
}

// helper only for typing above
async function getCtx() {
  return null as unknown as import("@supabase/supabase-js").SupabaseClient<
    import("@/integrations/supabase/types").Database
  >;
}

export const inviteTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        businessId: z.string().uuid(),
        email: z.string().trim().email().max(200),
        displayName: z.string().trim().max(120).nullable().default(null),
        role: z.enum(["admin", "agent", "viewer"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const business = await assertOwner(supabase, data.businessId);
    if (business.owner_id !== userId) throw new Error("Only the workspace owner can invite teammates");

    const email = data.email.toLowerCase();

    // Link the membership to an existing account when one exists.
    let linkedUserId: string | null = null;
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      linkedUserId = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
    } catch {
      linkedUserId = null;
    }

    const { data: row, error } = await supabase
      .from("business_members")
      .upsert(
        {
          business_id: data.businessId,
          email,
          display_name: data.displayName,
          role: data.role,
          user_id: linkedUserId,
          invited_by: userId,
        },
        { onConflict: "business_id,email" },
      )
      .select("id,email,role,user_id,display_name,created_at")
      .single();
    if (error) throw new Error(error.message);

    return { member: row, linked: Boolean(linkedUserId) };
  });

export const relinkTeamMembers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ businessId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const business = await assertOwner(supabase, data.businessId);
    if (business.owner_id !== userId) throw new Error("Only the workspace owner can do this");

    const { data: pending } = await supabase
      .from("business_members")
      .select("id,email")
      .eq("business_id", data.businessId)
      .is("user_id", null);
    if (!pending?.length) return { linked: 0 };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: list } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    let linked = 0;
    for (const p of pending) {
      const match = list?.users?.find((u) => (u.email ?? "").toLowerCase() === p.email.toLowerCase());
      if (!match) continue;
      const { error } = await supabase.from("business_members").update({ user_id: match.id }).eq("id", p.id);
      if (!error) linked++;
    }
    return { linked };
  });
