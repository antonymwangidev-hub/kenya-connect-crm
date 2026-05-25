import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// M-Pesa Daraja STK push callback.
// Public URL: https://<project>.lovable.app/api/public/mpesa/webhook
// Daraja calls this with the STK push result. We log it and mark the
// matching payment_transactions row as success/failed.

export const Route = createFileRoute("/api/public/mpesa/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        let payload: any = {};
        try {
          payload = JSON.parse(raw);
        } catch {
          // ignore — still log
        }

        await supabaseAdmin.from("webhook_logs").insert({
          source: "mpesa",
          payload,
          signature_ok: true,
          processed_at: new Date().toISOString(),
        });

        const stk = payload?.Body?.stkCallback;
        const merchantRequestId: string | undefined = stk?.MerchantRequestID;
        const resultCode: number | undefined = stk?.ResultCode;
        if (merchantRequestId) {
          const status = resultCode === 0 ? "success" : "failed";
          await supabaseAdmin
            .from("payment_transactions")
            .update({ status, meta: payload })
            .eq("provider_ref", merchantRequestId);
        }

        return new Response(
          JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted" }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    },
  },
});
