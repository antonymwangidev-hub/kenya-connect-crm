import { describe, it, expect, beforeEach, vi } from "vitest";
import { resetState, state, getHandlers, jsonPost, formPost } from "./_helpers";

// Import routes AFTER mocks are registered in _helpers
import { Route as MpesaRoute } from "@/routes/api/public/mpesa.webhook";
import { Route as AtRoute } from "@/routes/api/public/at.webhook";
import { Route as WhatsAppRoute } from "@/routes/api/public/whatsapp.webhook";
import { Route as RemindersRoute } from "@/routes/api/public/run-reminders";

const mpesa = getHandlers(MpesaRoute);
const at = getHandlers(AtRoute);
const wa = getHandlers(WhatsAppRoute);
const cron = getHandlers(RemindersRoute);

beforeEach(() => {
  resetState();
  vi.unstubAllEnvs();
});

describe("M-Pesa webhook", () => {
  const url = "https://app.test/api/public/mpesa/webhook";

  it("returns 429 when rate limited", async () => {
    state.rateLimitAllow = false;
    const res = await mpesa.POST!({ request: jsonPost(url, {}) });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    const body = await res.json();
    expect(body).toEqual({ error: "rate_limited" });
  });

  it("rejects oversized payload with 413 JSON ResultCode 1", async () => {
    const req = new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "content-length": "20000" },
      body: "{}",
    });
    const res = await mpesa.POST!({ request: req });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.ResultCode).toBe(1);
    expect(body.ResultDesc).toMatch(/too large/i);
  });

  it("ACKs malformed JSON with 200 and logs the failure", async () => {
    const req = new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "content-length": "10" },
      body: "not-json{{",
    });
    const res = await mpesa.POST!({ request: req });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ResultCode: 0, ResultDesc: "Accepted" });
    expect(state.webhookLogInserts).toHaveLength(1);
    expect(state.webhookLogInserts[0]).toMatchObject({ source: "mpesa", signature_ok: false, error: "invalid_json" });
  });

  it("ACKs schema-invalid payload with 200 and records signature_ok=false", async () => {
    const res = await mpesa.POST!({ request: jsonPost(url, { Body: { stkCallback: { foo: "bar" } } }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ResultCode).toBe(0);
    expect(state.webhookLogInserts[0]).toMatchObject({ source: "mpesa", signature_ok: false });
  });

  it("accepts a valid callback and updates payment_transactions", async () => {
    const payload = {
      Body: {
        stkCallback: {
          MerchantRequestID: "MR-1",
          CheckoutRequestID: "CR-1",
          ResultCode: 0,
          ResultDesc: "Success",
        },
      },
    };
    const res = await mpesa.POST!({ request: jsonPost(url, payload) });
    expect(res.status).toBe(200);
    expect(state.webhookLogInserts[0]).toMatchObject({ signature_ok: true });
    expect(state.paymentUpdates[0]).toMatchObject({ status: "success" });
  });
});

describe("Africa's Talking webhook", () => {
  const url = "https://app.test/api/public/at/webhook";

  it("returns 429 when rate limited", async () => {
    state.rateLimitAllow = false;
    const res = await at.POST!({ request: formPost(url, { from: "+254700000000", text: "hi" }) });
    expect(res.status).toBe(429);
  });

  it("ACKs oversized payload without processing", async () => {
    const req = formPost(url, { from: "+254700000000", text: "x" }, { "content-length": "20000" });
    const res = await at.POST!({ request: req });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(state.messageInserts).toHaveLength(0);
  });

  it("logs validation failure for invalid phone format", async () => {
    state.existingCreds = [{ business_id: "biz-1", credentials: {} }];
    const res = await at.POST!({ request: formPost(url, { from: "not-a-phone", text: "hi" }) });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
    expect(state.webhookLogInserts[0]).toMatchObject({ source: "africastalking", signature_ok: false });
    expect(state.messageInserts).toHaveLength(0);
  });

  it("accepts valid SMS, creates contact and message", async () => {
    state.existingCreds = [{ business_id: "biz-1", credentials: { sender_id: "BRAND" } }];
    const res = await at.POST!({
      request: formPost(url, { from: "+254700000001", to: "BRAND", text: "hello there" }),
    });
    expect(res.status).toBe(200);
    expect(state.contactInserts).toHaveLength(1);
    expect(state.messageInserts[0]).toMatchObject({ direction: "inbound", channel: "sms", content: "hello there" });
    expect(state.webhookLogInserts.at(-1)).toMatchObject({ signature_ok: true });
  });
});

describe("WhatsApp webhook", () => {
  const url = "https://app.test/api/public/whatsapp/webhook";

  it("returns 429 when rate limited", async () => {
    state.rateLimitAllow = false;
    const res = await wa.POST!({ request: jsonPost(url, {}) });
    expect(res.status).toBe(429);
  });

  it("returns 413 on oversized payload", async () => {
    const req = new Request(url, {
      method: "POST",
      headers: { "content-length": "100000" },
      body: "{}",
    });
    const res = await wa.POST!({ request: req });
    expect(res.status).toBe(413);
  });

  it("rejects when signature header missing", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "test-secret");
    const res = await wa.POST!({ request: jsonPost(url, { entry: [] }) });
    expect(res.status).toBe(401);
    expect(await res.text()).toMatch(/invalid signature/i);
  });

  it("rejects malformed signature scheme", async () => {
    vi.stubEnv("WHATSAPP_APP_SECRET", "test-secret");
    const res = await wa.POST!({
      request: jsonPost(url, { entry: [] }, { "x-hub-signature-256": "md5=abc" }),
    });
    expect(res.status).toBe(401);
  });

  it("verification GET returns challenge with valid token", async () => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "vtok");
    const req = new Request(`${url}?hub.mode=subscribe&hub.verify_token=vtok&hub.challenge=xyz`);
    const res = await wa.GET!({ request: req });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("xyz");
  });

  it("verification GET rejects wrong token", async () => {
    vi.stubEnv("WHATSAPP_VERIFY_TOKEN", "vtok");
    const req = new Request(`${url}?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=xyz`);
    const res = await wa.GET!({ request: req });
    expect(res.status).toBe(403);
  });
});

describe("Run-reminders cron", () => {
  const url = "https://app.test/api/public/run-reminders";

  it("returns 401 JSON when CRON_SECRET configured and missing", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const res = await cron.POST!({ request: new Request(url, { method: "POST" }) });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("accepts via x-cron-secret header", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const res = await cron.POST!({
      request: new Request(url, { method: "POST", headers: { "x-cron-secret": "topsecret" } }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 0 });
  });

  it("accepts via ?token= query", async () => {
    vi.stubEnv("CRON_SECRET", "topsecret");
    const res = await cron.POST!({
      request: new Request(`${url}?token=topsecret`, { method: "POST" }),
    });
    expect(res.status).toBe(200);
  });

  it("returns 429 when rate limited", async () => {
    state.rateLimitAllow = false;
    const res = await cron.POST!({ request: new Request(url, { method: "POST" }) });
    expect(res.status).toBe(429);
  });

  it("processes due reminders and writes automation_runs", async () => {
    state.remindersDue = [
      { id: "r1", business_id: "b1", contact_id: "c1", note: "call back" },
      { id: "r2", business_id: "b1", contact_id: "c2", note: "follow up" },
    ];
    const res = await cron.POST!({ request: new Request(url, { method: "POST" }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 2 });
    expect(state.automationInserts).toHaveLength(2);
    expect(state.reminderUpdates).toHaveLength(2);
  });
});
