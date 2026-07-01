import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Signed upload URL for the private `chat-media` bucket. Client uses this
// to POST the file directly to storage without exposing service credentials.
export const createChatMediaUploadUrl = createServerFn({ method: "POST" })
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
    const path = `${userId}/${data.contactId}/${Date.now()}-${safe}`;
    const { data: signed, error } = await supabase.storage
      .from("chat-media")
      .createSignedUploadUrl(path);
    if (error || !signed) throw new Error(error?.message ?? "Upload URL failed");
    return { path, token: signed.token };
  });

// Signed download URL, used by the chat UI to display private media.
export const getChatMediaSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ path: z.string().min(1).max(500) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: signed, error } = await supabase.storage
      .from("chat-media")
      .createSignedUrl(data.path, 60 * 60);
    if (error || !signed) throw new Error(error?.message ?? "Signed URL failed");
    return { url: signed.signedUrl };
  });
