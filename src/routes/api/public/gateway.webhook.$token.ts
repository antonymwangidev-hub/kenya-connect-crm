import { createFileRoute } from "@tanstack/react-router";
import { handleGatewayWebhook } from "@/lib/gateway-webhook.server";

// Per-workspace receiving endpoint: /api/public/gateway/webhook/<token>
export const Route = createFileRoute("/api/public/gateway/webhook/$token")({
  server: {
    handlers: {
      POST: async ({ request, params }) => handleGatewayWebhook(request, params.token ?? null),
    },
  },
});
