import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Search, MessageCircle, Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ContactAvatar } from "@/components/ContactAvatar";
import { AgentAvatar } from "./AgentAvatar";
import { STATUSES, statusMeta, timeAgo, type InboxConversation, type TeamMember } from "./inbox-types";

export type InboxFilter = "all" | "mine" | "unassigned" | "open" | "pending" | "resolved" | "spam";

const FILTERS: { value: InboxFilter; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "mine", label: "Mine" },
  { value: "unassigned", label: "Unassigned" },
  { value: "pending", label: "Pending" },
  { value: "resolved", label: "Resolved" },
  { value: "spam", label: "Spam" },
  { value: "all", label: "All" },
];

export function InboxSidebar({
  conversations,
  loading,
  activeId,
  userId,
  members,
  filter,
  onFilterChange,
  labelsByConversation,
}: {
  conversations: InboxConversation[];
  loading: boolean;
  activeId: string | null;
  userId: string | null;
  members: TeamMember[];
  filter: InboxFilter;
  onFilterChange: (f: InboxFilter) => void;
  labelsByConversation: Record<string, string[]>;
}) {
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: conversations.length, mine: 0, unassigned: 0, open: 0, pending: 0, resolved: 0, spam: 0 };
    for (const conv of conversations) {
      if (conv.assigned_to && conv.assigned_to === userId) c.mine++;
      if (!conv.assigned_to) c.unassigned++;
      c[conv.status] = (c[conv.status] ?? 0) + 1;
    }
    return c;
  }, [conversations, userId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return conversations.filter((c) => {
      const passFilter =
        filter === "all"
          ? true
          : filter === "mine"
          ? c.assigned_to === userId
          : filter === "unassigned"
          ? !c.assigned_to
          : c.status === filter;
      if (!passFilter) return false;
      if (!q) return true;
      const labels = labelsByConversation[c.id] ?? [];
      return (
        c.contact.name.toLowerCase().includes(q) ||
        c.contact.phone.includes(q) ||
        (c.last_message_preview ?? "").toLowerCase().includes(q) ||
        labels.some((l) => l.toLowerCase().includes(q))
      );
    });
  }, [conversations, filter, search, userId, labelsByConversation]);

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="border-b px-4 pb-2 pt-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Shared inbox</h2>
          <span className="text-xs text-muted-foreground">{filtered.length}</span>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Search name, phone, label…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Filter className="mt-1 hidden h-3.5 w-3.5 shrink-0 text-muted-foreground sm:block" />
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => onFilterChange(f.value)}
            className={`shrink-0 rounded-full px-2.5 py-1 text-xs transition ${
              filter === f.value ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-muted/70"
            }`}
          >
            {f.label}
            {counts[f.value] > 0 && <span className="ml-1 opacity-70">{counts[f.value]}</span>}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex animate-pulse items-start gap-3 border-b px-4 py-3">
              <div className="h-10 w-10 shrink-0 rounded-full bg-muted" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-1/2 rounded bg-muted" />
                <div className="h-3 w-3/4 rounded bg-muted/70" />
              </div>
            </div>
          ))
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <MessageCircle className="h-8 w-8 opacity-40" />
            <p>No conversations in this view.</p>
          </div>
        ) : (
          filtered.map((c) => {
            const isActive = c.id === activeId;
            const unread = c.unread_count > 0;
            const status = statusMeta(c.status);
            const member = members.find((m) => m.user_id === c.assigned_to);
            const labels = labelsByConversation[c.id] ?? [];
            return (
              <Link
                key={c.id}
                to="/app/inbox/$conversationId"
                params={{ conversationId: c.id }}
                className={`flex w-full items-start gap-3 border-b px-4 py-3 text-left transition-colors ${
                  isActive ? "bg-accent" : "hover:bg-muted/60"
                }`}
              >
                <div className="relative">
                  <ContactAvatar name={c.contact.name} avatarUrl={c.contact.avatar_url} size={40} />
                  <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full ring-2 ring-card ${status.dot}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>{c.contact.name}</p>
                    <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(c.last_message_at)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate text-xs ${unread ? "text-foreground" : "text-muted-foreground"}`}>
                      {c.last_direction === "outbound" && "You: "}
                      {c.last_message_preview ?? c.contact.phone}
                    </p>
                    {unread && (
                      <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                        {c.unread_count}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1">
                    <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${status.chip}`}>{status.label}</span>
                    {c.assigned_to ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        <AgentAvatar member={member} size={12} /> {member?.display_name || member?.email?.split("@")[0] || "Agent"}
                      </span>
                    ) : (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Unassigned</span>
                    )}
                    {labels.slice(0, 2).map((l) => (
                      <span key={l} className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">{l}</span>
                    ))}
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
      <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
        Statuses: {STATUSES.map((s) => s.label).join(" · ")}
      </div>
    </div>
  );
}
