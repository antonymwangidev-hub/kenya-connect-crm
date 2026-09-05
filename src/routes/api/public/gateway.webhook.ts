import { createFileRoute } from "@tanstack/react-router";
import { handleGatewayWebhook } from "@/lib/gateway-webhook.server";

// Legacy tokenless endpoint — kept working for gateways registered before
// per-workspace webhook tokens existed. New connections use
// /api/public/gateway/webhook/<token>.
export const Route = createFileRoute("/api/public/gateway/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handleGatewayWebhook(request, null),
    },
  },
});
