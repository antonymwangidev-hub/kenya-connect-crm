import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type KnowledgeEntry = {
  id: string;
  business_id: string;
  title: string;
  category: string;
  content: string;
  keywords: string | null;
  priority: number;
  is_active: boolean;
  updated_at: string;
};

export const KNOWLEDGE_CATEGORIES = [
  "general",
  "products",
  "pricing",
  "policies",
  "delivery",
  "payments",
  "support",
  "faq",
] as const;

export const listKnowledgeEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: biz } = await supabase
      .from("businesses").select("id").eq("owner_id", context.userId).limit(1).maybeSingle();
    if (!biz) throw new Error("No business");
    const { data, error } = await supabase
      .from("ai_knowledge_entries")
      .select("*")
      .eq("business_id", biz.id)
      .order("priority", { ascending: false })
      .order("updated_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { entries: (data ?? []) as KnowledgeEntry[] };
  });

export const saveKnowledgeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        id: z.string().uuid().nullable().optional(),
        title: z.string().min(1).max(200),
        category: z.string().min(1).max(60).default("general"),
        content: z.string().max(50000).default(""),
        keywords: z.string().max(1000).optional().default(""),
        priority: z.number().int().min(0).max(100).default(0),
        is_active: z.boolean().default(true),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: biz } = await supabase
      .from("businesses").select("id").eq("owner_id", context.userId).limit(1).maybeSingle();
    if (!biz) throw new Error("No business");

    const row = {
      business_id: biz.id,
      title: data.title,
      category: data.category,
      content: data.content,
      keywords: data.keywords || null,
      priority: data.priority,
      is_active: data.is_active,
    };

    if (data.id) {
      const { error } = await supabase
        .from("ai_knowledge_entries")
        .update(row)
        .eq("id", data.id)
        .eq("business_id", biz.id);
      if (error) throw new Error(error.message);
      return { ok: true, id: data.id };
    }

    const { data: inserted, error } = await supabase
      .from("ai_knowledge_entries")
      .insert(row)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { ok: true, id: inserted.id };
  });

export const deleteKnowledgeEntry = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: biz } = await supabase
      .from("businesses").select("id").eq("owner_id", context.userId).limit(1).maybeSingle();
    if (!biz) throw new Error("No business");
    const { error } = await supabase
      .from("ai_knowledge_entries")
      .delete()
      .eq("id", data.id)
      .eq("business_id", biz.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
