import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Lets request handlers keep work running after the HTTP response is sent.
 *
 * Webhook senders (the Nexus gateway, Meta) give up after a few seconds and
 * the hosting runtime cancels unfinished work once the caller disconnects.
 * AI replies take longer than that, so they must be registered with the
 * runtime's waitUntil instead of being awaited inside the request.
 */
type WaitUntilCtx = { waitUntil?: (p: Promise<unknown>) => void };

const store = new AsyncLocalStorage<WaitUntilCtx | undefined>();

export function runWithExecutionContext<T>(ctx: unknown, fn: () => T): T {
  return store.run(ctx as WaitUntilCtx | undefined, fn);
}

export function runInBackground(task: Promise<unknown>, label = "background task") {
  const safe = task.catch((err) => console.error(`[${label}] failed`, err));
  const ctx = store.getStore();
  if (ctx && typeof ctx.waitUntil === "function") {
    ctx.waitUntil(safe);
  }
  // Without a runtime context (local dev on Node) the promise simply keeps running.
}
