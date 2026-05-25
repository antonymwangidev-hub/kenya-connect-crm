## Goal

Refactor the existing onboarding + WhatsApp connection flow into a guided, non-technical experience for African SMEs. Preserve the existing CRM, inbox, automations, templates, reminders, and contacts. No rebuild — surgical additions and replacements.

## Scope (in)

1. New guided "Connect WhatsApp" flow with two paths: **Use my number** (Meta Embedded Signup placeholder) and **Get a new business number** (AT virtual number + M-Pesa).
2. Rewrite `src/routes/app.onboarding.tsx` into a mobile-first, step-by-step wizard with progress, success states, friendly copy, and zero technical terms.
3. Business verification step: certificate + owner ID upload to `business-assets` storage, suggested WhatsApp display name with mismatch warning.
4. New **Connection Status** page (`/app/whatsapp`) showing number, status, quality, connected date, template/subscription status with reconnect/disconnect/buy-another actions.
5. Backend tables for the new flows + RLS.
6. Centralized webhook stubs ready for AT master account + Meta ESU. Real provider calls remain stubbed until you hand over credentials — same pattern as existing `channel_credentials`.
7. Replace technical language across onboarding + settings ("API", "webhook", "WABA", "BSP", "token" → "Connect WhatsApp", "Business Number", "Messages").

## Scope (out)

- No changes to inbox, contacts, automations, templates, reminders, broadcasts, analytics UI.
- No M-Pesa / AT / Meta production credentials wired (placeholders + DB-driven creds, same as today).
- No rewrite of `messaging.functions.ts` beyond reading from the new `whatsapp_connections` table when present.

## Database migration

New tables (all RLS-scoped via `owns_business`):

- `whatsapp_connections` — business_id, phone_number, phone_number_id, waba_id, display_name, status (`pending|connecting|connected|disconnected|error`), quality_rating, connected_at, disconnected_at, meta jsonb.
- `business_verifications` — business_id, legal_name, certificate_url, owner_id_url, suggested_display_name, status (`pending|submitted|approved|rejected`), notes, submitted_at.
- `virtual_numbers` — business_id, phone_number, provider (`africastalking`), provider_sub_account, status (`available|reserved|active|released`), purchased_at, price_kes.
- `payment_transactions` — business_id, amount, currency, provider (`mpesa|paystack`), provider_ref, purpose (`number_purchase|subscription|topup`), status (`pending|success|failed`), meta jsonb.
- `onboarding_sessions` — business_id, step, path (`existing|new_number`), data jsonb, completed_at.
- `webhook_logs` — business_id, source (`whatsapp|africastalking|meta|mpesa`), payload jsonb, signature_ok bool, processed_at, error text.
- `message_delivery_logs` — message_id, status (`queued|sent|delivered|read|failed`), provider_status, error text, updated_at.

Storage: reuse `business-assets` bucket with per-business folder policy already in place.

## Files

**Created**
- `src/routes/app.whatsapp.tsx` — Connection status dashboard.
- `src/routes/api/public/mpesa.webhook.ts` — STK callback stub with signature/log.
- `src/routes/api/public/whatsapp.webhook.ts` already exists — extend to write `webhook_logs` + route per business via `phone_number_id`.
- `src/lib/whatsapp.functions.ts` — server fns: `startEmbeddedSignup` (returns stub URL/config), `completeEmbeddedSignup`, `disconnectWhatsapp`, `getConnection`.
- `src/lib/virtual-numbers.functions.ts` — `listAvailableNumbers`, `reserveNumber`, `purchaseNumber` (creates `payment_transactions` row + triggers STK push stub).
- `src/lib/verification.functions.ts` — `submitVerification`, `getVerification`.
- `src/components/onboarding/StepCard.tsx`, `Progress.tsx`, `Success.tsx` — shared wizard primitives.

**Edited**
- `src/routes/app.onboarding.tsx` — rewritten as 5-step wizard: Business profile → Verification → Connect WhatsApp (choose path) → Path A or B sub-flow → Done.
- `src/routes/app.settings.tsx` — strip API/webhook/token wording; link to `/app/whatsapp` for connection management instead of raw credential entry. Keep advanced channel_credentials editor behind a collapsed "Advanced" section.
- `src/routes/app.tsx` — add `/app/whatsapp` nav entry; keep onboarding redirect.
- `src/lib/messaging.functions.ts` — when sending WhatsApp, prefer `whatsapp_connections.phone_number_id` over legacy `channel_credentials` if present.

## UX details

- Mobile-first: full-bleed step cards, 56px primary buttons, single-column, sticky bottom CTA.
- Progress bar at top (Step N of 5) + checklist on completion screen.
- Path A warning modal with explicit checkbox: "I understand WhatsApp app will sign out on this phone."
- Path B: number list with KES pricing, M-Pesa STK confirmation screen, polling spinner, success animation.
- Display-name validator: warn if entered display name doesn't share ≥1 significant word with legal business name.
- Friendly copy throughout — never "API", "webhook", "WABA", "token", "BSP".

## What requires you later

- Meta App ID + Embedded Signup config token (saved via Settings → Advanced when ready).
- Africa's Talking master API key + username (saved via Settings → Advanced).
- M-Pesa Daraja consumer key/secret + shortcode (saved via Settings → Advanced).
Until then, Path B and Embedded Signup show a friendly "Coming soon — your number will be reserved" state and create the DB records so the flow is testable end-to-end.

## Implementation order

1. Migration (tables + RLS).
2. Server fns + webhook routes.
3. Onboarding wizard rewrite + shared components.
4. `/app/whatsapp` connection dashboard.
5. Settings cleanup + nav update.
