# PulseCRM Upgrade Plan

Big scope — I'll ship it in one pass but keep each piece minimal and SME-friendly. No new external API keys required now; integration adapters will be stubbed and activated when you add credentials later.

## 1. Google Sign-In
- Enable Google OAuth via Lovable Cloud managed provider.
- Update `src/routes/auth.tsx` with a "Continue with Google" button using `lovable.auth.signInWithOAuth("google")`.

## 2. Onboarding & Setup Wizard (`/app/onboarding`)
- New route, runs once after signup until `businesses.onboarded_at` is set.
- Steps: **Business profile** (name, logo upload, default greeting, business hours) → **Phone + M-Pesa till/paybill** → **Channel connect** (WhatsApp Business API + Africa's Talking SMS — credentials optional, can skip) → **Import contacts** (CSV paste or skip).
- DB: extend `businesses` with `logo_url`, `phone`, `mpesa_number`, `mpesa_type`, `default_greeting`, `business_hours jsonb`, `onboarded_at`.
- New tables: `channel_credentials` (provider, credentials jsonb, is_active) so WA/AT keys plug in later without code changes.
- Storage bucket: `business-assets` for logos.

## 3. Shared Inbox Improvements
- Extend `conversations` with `assigned_to uuid` (auth user) and `team text` (sales/support/general).
- New `conversation_notes` table (internal notes per conversation, agent-only).
- New `business_members` table for inviting teammates by email + role (owner/agent).
- Inbox UI: assignee dropdown, team filter chips, notes panel in conversation drawer.

## 4. Auto-Replies & Message Templates
- New `message_templates` table (name, body, category, variables).
- Extend `automation_rules` triggers: `keyword_match`, `out_of_hours`, `first_message`.
- Templates manager at `/app/templates`; insertable into composer via "/" picker.

## 5. Reminders & Follow-ups
- New `reminders` table (contact_id, due_at, note, status, created_by).
- UI at `/app/reminders` + reminder button in conversation header.
- pg_cron job hourly → calls `/api/public/run-reminders` which fires automation actions for due reminders (sends via active channel or marks pending).

## 6. WhatsApp Business API + Africa's Talking Adapters
- `src/lib/channels/whatsapp.server.ts` and `src/lib/channels/africastalking.server.ts` with `sendMessage()` that reads creds from `channel_credentials`.
- Existing `messaging.functions.ts` `sendFn` routes to the active provider; falls back to "manual" channel if none configured.
- Webhook routes: `/api/public/whatsapp.webhook` (already exists, extended) and `/api/public/at.webhook` for inbound — both verify signature/token from `channel_credentials`.

## 7. Technical notes
- All new tables have RLS via `owns_business()`.
- Logo upload uses public storage bucket with per-business folder policy.
- No new runtime secrets needed now; you'll add WA token + AT key + M-Pesa creds later via Settings UI (writes to `channel_credentials`).
- Onboarding wizard is skippable per step; nothing blocks usage of the app.

Approve and I'll build it.
