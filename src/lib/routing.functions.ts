import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Re-evaluates routing rules for the whole business (via the scoring engine,
 * which routes each lead) and then flushes any queued outreach messages.
 */
export const runRoutingNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ businessId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabase } = context;

    const { data: canWrite, error: permErr } = await supabase.rpc("can_write_business", {
      _business_id: data.businessId,
    });
    if (permErr) throw new Error(permErr.message);
    if (!canWrite) throw new Error("Not authorized for this business");

    const { data: rescored, error } = await supabase.rpc("recalc_business_lead_scores", {
      _business_id: data.businessId,
      _reason: "routing_run",
    });
    if (error) throw new Error(error.message);

    const { processRoutingQueue } = await import("@/lib/routing.server");
    const queue = await processRoutingQueue({ businessId: data.businessId, limit: 100 });

    return { rescored: rescored ?? 0, ...queue };
  });
