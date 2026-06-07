import { vi } from "vitest";

// Shared in-memory state mutated by tests.
export const state = {
  rateLimitAllow: true as boolean,
  webhookLogInserts: [] as unknown[],
  paymentUpdates: [] as unknown[],
  messageInserts: [] as unknown[],
  contactInserts: [] as unknown[],
  reminderUpdates: [] as unknown[],
  automationInserts: [] as unknown[],
  existingContact: null as { id: string } | null,
  existingCreds: [] as Array<{ business_id: string; credentials: Record<string, unknown> }>,
  remindersDue: [] as Array<{ id: string; business_id: string; contact_id: string; note: string }>,
};

export function resetState() {
  state.rateLimitAllow = true;
  state.webhookLogInserts = [];
  state.paymentUpdates = [];
  state.messageInserts = [];
  state.contactInserts = [];
  state.reminderUpdates = [];
  state.automationInserts = [];
  state.existingContact = null;
  state.existingCreds = [];
  state.remindersDue = [];
}

// Mock the rate-limit module
vi.mock("@/lib/rate-limit.server", () => ({
  checkRateLimit: vi.fn(async () => state.rateLimitAllow),
  clientIp: vi.fn(() => "1.2.3.4"),
  tooManyRequests: () =>
    new Response(JSON.stringify({ error: "rate_limited" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    }),
}));

// Minimal chainable query builder mock
function tableBuilder(table: string) {
  const ctx: { filters: Record<string, unknown>; updates?: unknown; inserts?: unknown } = {
    filters: {},
  };
  const builder: any = {
    select: () => builder,
    eq: (_col: string, _val: unknown) => builder,
    lte: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: async () => {
      if (table === "contacts") return { data: state.existingContact, error: null };
      if (table === "businesses") return { data: { id: "biz-1" }, error: null };
      return { data: null, error: null };
    },
    single: async () => ({ data: { id: "new-contact-id" }, error: null }),
    insert: (row: unknown) => {
      if (table === "webhook_logs") state.webhookLogInserts.push(row);
      if (table === "messages") state.messageInserts.push(row);
      if (table === "contacts") {
        state.contactInserts.push(row);
        return {
          select: () => ({ single: async () => ({ data: { id: "new-contact-id" }, error: null }) }),
        };
      }
      if (table === "automation_runs") state.automationInserts.push(row);
      return Promise.resolve({ data: null, error: null });
    },
    update: (row: unknown) => {
      if (table === "payment_transactions") state.paymentUpdates.push(row);
      if (table === "reminders") state.reminderUpdates.push(row);
      return {
        eq: () => Promise.resolve({ data: null, error: null }),
      };
    },
    then: undefined,
  };
  // Allow `await supabaseAdmin.from('x').select(...).eq(...)` to resolve to a list
  // for channel_credentials / reminders SELECT paths.
  builder.then = (resolve: (v: unknown) => void) => {
    if (table === "channel_credentials") {
      resolve({ data: state.existingCreds, error: null });
    } else if (table === "reminders") {
      resolve({ data: state.remindersDue, error: null });
    } else {
      resolve({ data: [], error: null });
    }
  };
  return builder;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => tableBuilder(table),
    rpc: async () => ({ data: true, error: null }),
  },
}));

export type RouteHandlers = {
  POST?: (args: { request: Request; params?: Record<string, string> }) => Promise<Response>;
  GET?: (args: { request: Request; params?: Record<string, string> }) => Promise<Response>;
};

export function getHandlers(route: unknown): RouteHandlers {
  // createFileRoute returns an object whose options carry the server config.
  // Support both `.options` and direct `.server` shapes for resilience.
  const r = route as Record<string, any>;
  const server = r?.options?.server ?? r?.server ?? r?.update?.()?.options?.server;
  const h = server?.handlers;
  if (typeof h === "function") {
    return h({ createHandlers: (x: RouteHandlers) => x });
  }
  return h as RouteHandlers;
}

export function jsonPost(url: string, body: unknown, headers: Record<string, string> = {}) {
  const raw = JSON.stringify(body);
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "content-length": String(raw.length), ...headers },
    body: raw,
  });
}

export function formPost(url: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request(url, { method: "POST", body: fd, headers });
}
