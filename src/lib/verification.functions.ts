import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyVerification = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data } = await supabase
      .from("business_verifications")
      .select("*")
      .maybeSingle();
    return { verification: data ?? null };
  });

export const submitVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        legalName: z.string().trim().min(2).max(120),
        suggestedDisplayName: z.string().trim().min(2).max(60),
        certificateUrl: z.string().url().optional().nullable(),
        ownerIdUrl: z.string().url().optional().nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: biz } = await supabase.from("businesses").select("id").limit(1).single();
    if (!biz) throw new Error("Business not found");
    const { data: row, error } = await supabase
      .from("business_verifications")
      .upsert(
        {
          business_id: biz.id,
          legal_name: data.legalName,
          suggested_display_name: data.suggestedDisplayName,
          certificate_url: data.certificateUrl ?? null,
          owner_id_url: data.ownerIdUrl ?? null,
          status: "submitted",
          submitted_at: new Date().toISOString(),
        },
        { onConflict: "business_id" },
      )
      .select()
      .single();
    if (error) throw new Error(error.message);
    return { verification: row };
  });
