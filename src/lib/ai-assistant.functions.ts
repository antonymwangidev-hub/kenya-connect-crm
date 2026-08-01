import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AiAssistantSettings = {
  business_id: string;
  enabled: boolean;
  business_description: string | null;
  products_services: string | null;
  contact_info: string | null;
  address: string | null;
  website: string | null;
  hours: string | null;
  faqs: string | null;
  tone: string;
  custom_instructions: string | null;
  strict_knowledge: boolean;
  fallback_message: string | null;
};

const DEFAULTS = {
  enabled: false,
  business_description: "",
  products_services: "",
  contact_info: "",
  address: "",
  website: "",
  hours: "",
  faqs: "",
  tone: "friendly",
  custom_instructions: "",
  strict_knowledge: true,
  fallback_message: "",
};

export const getAiAssistantSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data: biz } = await supabase
      .from("businesses").select("id").eq("owner_id", context.userId).limit(1).maybeSingle();
    if (!biz) throw new Error("No business");
    const { data } = await supabase
      .from("ai_assistant_settings").select("*").eq("business_id", biz.id).maybeSingle();
    return {
      settings: (data ?? { business_id: biz.id, ...DEFAULTS }) as AiAssistantSettings,
    };
  });

export const saveAiAssistantSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        enabled: z.boolean(),
        business_description: z.string().max(20000).optional().default(""),
        products_services: z.string().max(50000).optional().default(""),
        contact_info: z.string().max(2000).optional().default(""),
        address: z.string().max(1000).optional().default(""),
        website: z.string().max(500).optional().default(""),
        hours: z.string().max(1000).optional().default(""),
        faqs: z.string().max(50000).optional().default(""),
        tone: z.enum(["friendly", "professional", "casual", "sales"]).default("friendly"),
        custom_instructions: z.string().max(20000).optional().default(""),
        strict_knowledge: z.boolean().optional().default(true),
        fallback_message: z.string().max(1000).optional().default(""),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: biz } = await supabase
      .from("businesses").select("id").eq("owner_id", context.userId).limit(1).maybeSingle();
    if (!biz) throw new Error("No business");
    const { error } = await supabase
      .from("ai_assistant_settings")
      .upsert({ business_id: biz.id, ...data }, { onConflict: "business_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
