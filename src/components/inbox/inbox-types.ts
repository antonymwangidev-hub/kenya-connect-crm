export type ConversationStatus = "open" | "pending" | "resolved" | "spam";

export const STATUSES: { value: ConversationStatus; label: string; dot: string; chip: string }[] = [
  { value: "open", label: "Open", dot: "bg-emerald-500", chip: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-400" },
  { value: "pending", label: "Pending", dot: "bg-amber-500", chip: "bg-amber-500/12 text-amber-700 dark:text-amber-400" },
  { value: "resolved", label: "Resolved", dot: "bg-sky-500", chip: "bg-sky-500/12 text-sky-700 dark:text-sky-400" },
  { value: "spam", label: "Spam", dot: "bg-rose-500", chip: "bg-rose-500/12 text-rose-700 dark:text-rose-400" },
];

export function statusMeta(status: string | null | undefined) {
  return STATUSES.find((s) => s.value === status) ?? STATUSES[0];
}

export type TeamMember = {
  id: string;
  user_id: string | null;
  email: string;
  display_name: string | null;
  role: "admin" | "agent" | "viewer";
};

export type InboxContact = {
  id: string;
  name: string;
  phone: string;
  avatar_url: string | null;
};

export type InboxConversation = {
  id: string;
  business_id: string;
  contact_id: string;
  status: ConversationStatus;
  assigned_to: string | null;
  assigned_at: string | null;
  last_message_at: string;
  last_message_preview: string | null;
  last_direction: string | null;
  last_inbound_at: string | null;
  unread_count: number;
  contact: InboxContact;
};

export type InboxMessage = {
  id: string;
  contact_id: string;
  conversation_id: string | null;
  direction: "inbound" | "outbound";
  content: string;
  channel: "manual" | "whatsapp" | "sms";
  created_at: string;
  media_url: string | null;
  media_type: "image" | "video" | "audio" | "document" | null;
  media_mime: string | null;
  media_filename: string | null;
  media_size: number | null;
  reactions?: { emoji: string; direction: string; at: string }[] | null;
};

export function timeAgo(iso: string) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString();
}

export function dateLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const same = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (same(d, today)) return "Today";
  if (same(d, yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

export function memberLabel(member: TeamMember | undefined | null) {
  if (!member) return "Unassigned";
  return member.display_name?.trim() || member.email.split("@")[0];
}

/** 24h WhatsApp customer-service window. */
export function sessionWindow(lastInboundAt: string | null) {
  if (!lastInboundAt) {
    return { open: false, label: "No inbound message yet — start with a template.", color: "red" as const };
  }
  const remaining = new Date(lastInboundAt).getTime() + 24 * 3600 * 1000 - Date.now();
  if (remaining <= 0) {
    return { open: false, label: "24h window closed — send an approved template to reopen.", color: "red" as const };
  }
  const hours = Math.ceil(remaining / 3_600_000);
  if (hours <= 3) return { open: true, label: `Session expires in ~${hours}h`, color: "orange" as const };
  return { open: true, label: `24-hour session active · ${hours}h left`, color: "green" as const };
}
