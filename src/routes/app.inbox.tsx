import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { InboxSidebar, type InboxFilter } from "@/components/inbox/InboxSidebar";
import type { InboxConversation, TeamMember } from "@/components/inbox/inbox-types";

export const Route = createFileRoute("/app/inbox")({
  head: () => ({
    meta: [
      { title: "Shared Inbox — PulseCRM" },
      { name: "description", content: "Team WhatsApp inbox with assignments, statuses, labels and internal notes." },
      { property: "og:title", content: "Shared Inbox — PulseCRM" },
      { property: "og:description", content: "Team WhatsApp inbox with assignments, statuses, labels and internal notes." },
    ],
  }),
  component: InboxLayout,
});

type InboxCtx = {
  conversations: InboxConversation[];
  members: TeamMember[];
  patchConversation: (id: string, patch: Partial<InboxConversation>) => void;
  reload: () => void;
};

const Ctx = createContext<InboxCtx | null>(null);
export function useInbox() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useInbox must be used inside the inbox layout");
  return v;
}

function InboxLayout() {
  const { businessId, user, canWrite } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeId = pathname.startsWith("/app/inbox/") ? pathname.split("/app/inbox/")[1] || null : null;

  const [conversations, setConversations] = useState<InboxConversation[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [labels, setLabels] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<InboxFilter>("open");

  const load = useCallback(async () => {
    if (!businessId) return;
    const { data } = await supabase
      .from("conversations")
      .select(
        "id,business_id,contact_id,status,assigned_to,assigned_at,last_message_at,last_message_preview,last_direction,last_inbound_at,unread_count,contact:contacts!inner(id,name,phone,avatar_url)",
      )
      .eq("business_id", businessId)
      .order("last_message_at", { ascending: false })
      .limit(300);
    setConversations((data as unknown as InboxConversation[]) ?? []);
    setLoading(false);

    const { data: lbl } = await supabase
      .from("conversation_labels")
      .select("conversation_id,tag:tags!inner(name)")
      .limit(2000);
    const map: Record<string, string[]> = {};
    for (const row of (lbl ?? []) as unknown as { conversation_id: string; tag: { name: string } }[]) {
      (map[row.conversation_id] ??= []).push(row.tag.name);
    }
    setLabels(map);
  }, [businessId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from("business_members")
      .select("id,user_id,email,display_name,role")
      .eq("business_id", businessId)
      .then(({ data }) => setMembers((data as TeamMember[]) ?? []));
  }, [businessId]);

  // Realtime conversation list
  useEffect(() => {
    if (!businessId) return;
    const ch = supabase
      .channel(`inbox-convs-${businessId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversations", filter: `business_id=eq.${businessId}` }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [businessId, load]);

  const patchConversation = (id: string, patch: Partial<InboxConversation>) =>
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));

  // Desktop: auto-open the first conversation.
  useEffect(() => {
    if (activeId || loading || conversations.length === 0) return;
    if (typeof window !== "undefined" && window.innerWidth < 1024) return;
    navigate({ to: "/app/inbox/$conversationId", params: { conversationId: conversations[0].id } });
  }, [activeId, loading, conversations, navigate]);

  if (!businessId) return null;

  return (
    <Ctx.Provider value={{ conversations, members, patchConversation, reload: load }}>
      <div className="flex h-[calc(100vh-3.5rem)] min-h-0 w-full md:h-screen">
        <div className={`w-full shrink-0 border-r lg:block lg:w-80 xl:w-96 ${activeId ? "hidden" : "block"}`}>
          <InboxSidebar
            conversations={conversations}
            loading={loading}
            activeId={activeId}
            userId={user?.id ?? null}
            members={members}
            filter={filter}
            onFilterChange={setFilter}
            labelsByConversation={labels}
          />
        </div>
        <div className={`relative min-w-0 flex-1 ${activeId ? "block" : "hidden lg:block"}`}>
          {activeId ? (
            <Outlet />
          ) : (
            <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
              Select a conversation to start replying{canWrite ? "" : " (view only)"}.
            </div>
          )}
        </div>
      </div>
    </Ctx.Provider>
  );
}
