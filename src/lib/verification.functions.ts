import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const VERIF_BUCKET = "business-verification-docs";

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
        // Now expect storage paths inside the private bucket, not public URLs.
        certificatePath: z.string().trim().max(500).optional().nullable(),
        ownerIdPath: z.string().trim().max(500).optional().nullable(),
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
          // Re-use existing url columns to store the private storage path
          certificate_url: data.certificatePath ?? null,
          owner_id_url: data.ownerIdPath ?? null,
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

// Issue a short-lived signed upload URL so the browser can PUT the file directly
// into the private bucket without the secret transiting through this server.
export const createVerificationUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        kind: z.enum(["cert", "id"]),
        filename: z.string().trim().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: biz } = await supabase.from("businesses").select("id").limit(1).single();
    if (!biz) throw new Error("Business not found");
    const safeName = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
    const path = `${biz.id}/${data.kind}-${Date.now()}-${safeName}`;
    const { data: signed, error } = await supabase.storage
      .from(VERIF_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Could not create upload URL");
    return { path, token: signed.token, signedUrl: signed.signedUrl };
  });

// Short-lived signed download URL so the owner (or admin) can preview a doc.
export const createVerificationDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ path: z.string().trim().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: signed, error } = await supabase.storage
      .from(VERIF_BUCKET)
      .createSignedUrl(data.path, 60 * 5);
    if (error || !signed) throw new Error(error?.message ?? "Could not create signed URL");
    return { signedUrl: signed.signedUrl };
  });
