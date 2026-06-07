import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { checkRateLimit, clientIp, tooManyRequests } from "@/lib/rate-limit.server";

// M-Pesa Daraja STK push callback.
// Public URL: https://<project>.lovable.app/api/public/mpesa/webhook

const StkItem = z.object({
  Name: z.string().max(64),
  Value: z.union([z.string().max(256), z.number(), z.boolean()]).optional(),
});

const StkCallback = z.object({
  MerchantRequestID: z.string().min(1).max(128),
  CheckoutRequestID: z.string().min(1).max(128).optional(),
  ResultCode: z.number().int(),
  ResultDesc: z.string().max(512).optional(),
  CallbackMetadata: z.object({ Item: z.array(StkItem).max(20) }).optional(),
});

const PayloadSchema = z.object({
  Body: z.object({ stkCallback: StkCallback }),
});

const JSON_HEADERS = { "Content-Type": "application/json" } as const;
const ack = (extra?: Record<string, unknown>) =>
  new Response(JSON.stringify({ ResultCode: 0, ResultDesc: "Accepted", ...extra }), {
    status: 200,
    headers: JSON_HEADERS,
  });

export const Route = createFileRoute("/api/public/mpesa/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // Rate limit: 120 req/min per IP — generous for legitimate Daraja retries.
        const ip = clientIp(request);
        const allowed = await checkRateLimit("mpesa_webhook", ip, 120, 60);
        if (!allowed) return tooManyRequests();

        // Size guard — Daraja callbacks are small (<2KB typical).
        const contentLength = Number(request.headers.get("content-length") ?? "0");
        if (contentLength > 16_384) {
          return new Response(JSON.stringify({ ResultCode: 1, ResultDesc: "Payload too large" }), {
            status: 413,
            headers: JSON_HEADERS,
          });
        }

        let raw = "";
        try {
          raw = await request.text();
        } catch {
          return ack();
        }
        if (raw.length > 16_384) return ack();

        let parsed: unknown = null;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // Log malformed payload but always 200 so Daraja stops retrying.
          try {
            await supabaseAdmin.from("webhook_logs").insert({
              source: "mpesa",
              payload: { raw: raw.slice(0, 1000) },
              signature_ok: false,
              error: "invalid_json",
              processed_at: new Date().toISOString(),
            });
          } catch (e) {
            console.error("mpesa log insert failed", e);
          }
          return ack();
        }

        const result = PayloadSchema.safeParse(parsed);
        try {
          await supabaseAdmin.from("webhook_logs").insert({
            source: "mpesa",
            payload: parsed as never,
            signature_ok: result.success,
            error: result.success ? null : result.error.issues[0]?.message?.slice(0, 200) ?? "schema_error",
            processed_at: new Date().toISOString(),
          });
        } catch (e) {
          console.error("mpesa log insert failed", e);
        }

        if (!result.success) return ack();

        const stk = result.data.Body.stkCallback;
        try {
          await supabaseAdmin
            .from("payment_transactions")
            .update({
              status: stk.ResultCode === 0 ? "success" : "failed",
              meta: parsed as never,
            })
            .eq("provider_ref", stk.MerchantRequestID);
        } catch (e) {
          console.error("mpesa payment update failed", e);
        }

        return ack();
      },
    },
  },
});
