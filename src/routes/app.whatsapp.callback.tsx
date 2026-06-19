import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { z } from "zod";
import { exchangeWhatsappSignup } from "@/lib/whatsapp.functions";

// OAuth redirect target for Meta's "Valid OAuth Redirect URIs".
// Meta sends a short-lived ?code that we exchange server-side.
const searchSchema = z.object({
  code: z.string().optional(),
  state: z.string().optional(),
  error: z.string().optional(),
  error_description: z.string().optional(),
});

export const Route = createFileRoute("/app/whatsapp/callback")({
  validateSearch: (s) => searchSchema.parse(s),
  component: WhatsappCallback,
});

function WhatsappCallback() {
  const { code, error, error_description } = useSearch({ from: "/app/whatsapp/callback" });
  const navigate = useNavigate();
  const exchange = useServerFn(exchangeWhatsappSignup);
  const ran = useRef(false);
  const [status, setStatus] = useState<"working" | "ok" | "error">("working");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (error) {
      setStatus("error");
      setMessage(error_description ?? error);
      return;
    }
    if (!code) {
      setStatus("error");
      setMessage("Missing authorization code from Meta.");
      return;
    }
    const redirectUri = `${window.location.origin}/app/whatsapp/callback`;
    exchange({ data: { code, redirectUri } })
      .then(() => {
        setStatus("ok");
        setTimeout(() => navigate({ to: "/app/whatsapp" }), 800);
      })
      .catch((e: unknown) => {
        setStatus("error");
        setMessage(e instanceof Error ? e.message : "Failed to finish connection");
      });
  }, [code, error, error_description, exchange, navigate]);

  return (
    <div className="mx-auto grid min-h-[60vh] max-w-md place-items-center px-4">
      <div className="w-full space-y-3 rounded-2xl border bg-card p-6 text-center">
        {status === "working" && (
          <>
            <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
            <p className="font-semibold">Finishing your WhatsApp connection…</p>
            <p className="text-sm text-muted-foreground">Exchanging the secure code with Meta.</p>
          </>
        )}
        {status === "ok" && (
          <>
            <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-600" />
            <p className="font-semibold">Connected!</p>
            <p className="text-sm text-muted-foreground">Redirecting to your WhatsApp dashboard…</p>
          </>
        )}
        {status === "error" && (
          <>
            <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
            <p className="font-semibold">Could not finish connection</p>
            <p className="text-sm text-muted-foreground">{message}</p>
            <button
              type="button"
              onClick={() => navigate({ to: "/app/whatsapp" })}
              className="mt-2 text-sm underline"
            >
              Back to WhatsApp
            </button>
          </>
        )}
      </div>
    </div>
  );
}
