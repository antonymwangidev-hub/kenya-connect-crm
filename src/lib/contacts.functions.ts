import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const updateContact = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(120).optional(),
        phone: z
          .string()
          .trim()
          .min(7)
          .max(20)
          .regex(/^[+0-9\s-]+$/)
          .optional(),
        email: z.string().trim().email().max(200).optional().or(z.literal("")),
        notes: z.string().max(4000).optional().or(z.literal("")),
        avatar_url: z.string().url().max(500).optional().or(z.literal("")),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.phone !== undefined) patch.phone = data.phone;
    if (data.email !== undefined) patch.email = data.email || null;
    if (data.notes !== undefined) patch.notes = data.notes || null;
    if (data.avatar_url !== undefined) patch.avatar_url = data.avatar_url || null;

    const { data: updated, error } = await supabase
      .from("contacts")
      .update(patch as never)
      .eq("id", data.id)
      .select("id,name,phone,email,notes,avatar_url")
      .single();
    if (error) throw new Error(error.message);
    return updated;
  });

/**
 * Signed upload URL for a public contact-avatar path in the
 * `business-assets` bucket, so the returned public URL is stable
 * and doesn't need re-signing on every render.
 */
export const createContactAvatarUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        contactId: z.string().uuid(),
        filename: z.string().min(1).max(200),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const safe = data.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `contact-avatars/${userId}/${data.contactId}/${Date.now()}-${safe}`;
    const { data: signed, error } = await supabase.storage
      .from("business-assets")
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Upload URL failed");
    const { data: pub } = supabase.storage.from("business-assets").getPublicUrl(path);
    return { path, token: signed.token, publicUrl: pub.publicUrl };
  });
