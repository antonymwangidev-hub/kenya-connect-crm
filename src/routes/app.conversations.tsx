import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Send,
  ArrowDownLeft,
  ArrowUpRight,
  MessageCircle,
  Phone,
  Sparkles,
  Search,
  ArrowLeft,
  Wand2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { sendOutboundMessage } from "@/lib/messaging.functions";
import { suggestReply } from "@/lib/ai.functions";

type Tone = "polite" | "sales" | "urgent";

export const Route = createFileRoute("/app/conversations")({
  component: ConversationsPage,
});

type Channel = "manual" | "whatsapp" | "sms";
type Conversation = {
  id: string;
  contact_id: string;
  last_message_at: string;
  last_message_preview: string | null;
  last_direction: string | null;
  unread_count: number;
  contact: { id: string; name: string; phone: string };
};
type Message = {
  id: string;
  contact_id: string;
  conversation_id: string | null;
  direction: "inbound" | "outbound";
  content: string;
  channel: Channel;
  created_at: string;
};

function ChannelBadge({ channel }: { channel: Channel }) {
  if (channel === "whatsapp") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">
        <MessageCircle className="h-2.5 w-2.5" /> WhatsApp
      </span>
    );
  }
  if (channel === "sms") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-1.5 py-0.5 text-[9px] font-medium text-blue-600">
        <Phone className="h-2.5 w-2.5" /> SMS
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[9px] font-medium text-muted-foreground">
      Manual
    </span>
  );
}

function timeAgo(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return "now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  const days = Math.floor(diff / 86400);
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString();
}

function ConversationsPage() {
  const { businessId } = useAuth();
  const sendFn = useServerFn(sendOutboundMessage);
  const suggestFn = useServerFn(suggestReply);
  const [suggesting, setSuggesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [tone, setTone] = useState<Tone>("polite");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load conversations + realtime
  useEffect(() => {
    if (!businessId) return;
    let cancelled = false;
    const fetchConvs = async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select("id,contact_id,last_message_at,last_message_preview,last_direction,unread_count,contact:contacts!inner(id,name,phone)")
        .eq("business_id", businessId)
        .order("last_message_at", { ascending: false });
      if (cancelled) return;
      if (error) { toast.error(error.message); return; }
      setConversations((data as unknown as Conversation[]) ?? []);
    };
    fetchConvs();

    const ch = supabase
      .channel(`conv-${businessId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations", filter: `business_id=eq.${businessId}` },
        () => { fetchConvs(); },
      )
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(ch); };
  }, [businessId]);

  const active = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? null,
    [conversations, activeId],
  );

  // Load messages for active conversation + realtime + mark read
  useEffect(() => {
    if (!active) { setMessages([]); return; }
    let cancelled = false;
    supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", active.id)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { toast.error(error.message); return; }
        setMessages((data ?? []) as Message[]);
      });

    // Reset unread
    if (active.unread_count > 0) {
      supabase.from("conversations").update({ unread_count: 0 }).eq("id", active.id).then(() => {});
    }

    const channel = supabase
      .channel(`msg-${active.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${active.id}` },
        (payload) => {
          const m = payload.new as Message;
          setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
          // keep unread cleared while viewing
          supabase.from("conversations").update({ unread_count: 0 }).eq("id", active.id).then(() => {});
        },
      )
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [active?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.contact.name.toLowerCase().includes(q) ||
        c.contact.phone.includes(q) ||
        (c.last_message_preview ?? "").toLowerCase().includes(q),
    );
  }, [conversations, search]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!active || !draft.trim() || sending) return;
    const content = draft.trim();
    setDraft("");

    if (direction === "inbound") {
      const { error } = await supabase.from("messages").insert({
        contact_id: active.contact_id,
        direction: "inbound",
        content,
        channel: "manual",
      });
      if (error) toast.error(error.message);
      return;
    }

    setSending(true);
    try {
      const result = await sendFn({ data: { contactId: active.contact_id, content } });
      toast.success(`Sent via ${result.channel}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Send failed";
      toast.error(msg);
      await supabase.from("messages").insert({
        contact_id: active.contact_id,
        direction: "outbound",
        content,
        channel: "manual",
      });
    } finally {
      setSending(false);
    }
  };

  const generateFollowUp = async () => {
    if (!active) return;
    setGenerating(true);
    try {
      const { suggestion } = await suggestFn({ data: { contactId: active.contact_id, tone } });
      if (suggestion) {
        setDraft(suggestion);
        setDirection("outbound");
        toast.success("Follow-up ready — review and send");
      } else {
        toast.error("No suggestion returned");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex h-screen">
      {/* Conversation list */}
      <aside className={`${active ? "hidden md:flex" : "flex"} w-full shrink-0 flex-col border-r bg-card md:max-w-xs`}>
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Inbox</h2>
          <p className="text-xs text-muted-foreground">
            {conversations.length} conversation{conversations.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="border-b px-3 py-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-8"
              placeholder="Search name, phone, message…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              {conversations.length === 0
                ? "No conversations yet. Incoming WhatsApp messages create them automatically, or add a contact."
                : "No matches."}
            </p>
          ) : (
            filtered.map((c) => {
              const isActive = c.id === activeId;
              const unread = c.unread_count > 0;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`flex w-full items-start gap-3 border-b px-4 py-3 text-left transition ${
                    isActive ? "bg-accent" : "hover:bg-muted"
                  }`}
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                    {c.contact.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>
                        {c.contact.name}
                      </p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {timeAgo(c.last_message_at)}
                      </span>
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
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      {/* Chat panel */}
      <section className={`${active ? "flex" : "hidden md:flex"} flex-1 flex-col`} style={{ backgroundColor: "var(--chat-bg)" }}>
        {!active ? (
          <div className="grid flex-1 place-items-center text-center text-muted-foreground">
            <div>
              <MessageCircle className="mx-auto h-10 w-10 opacity-40" />
              <p className="mt-3 text-sm">Select a conversation</p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b bg-card px-4 py-3">
              <button
                onClick={() => setActiveId(null)}
                className="rounded-md p-1 hover:bg-muted md:hidden"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                {active.contact.name.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{active.contact.name}</p>
                <p className="truncate text-xs text-muted-foreground">{active.contact.phone}</p>
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto scroll-smooth px-4 py-6">
              {messages.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground">No messages yet. Send the first one.</p>
              ) : (
                messages.map((m) => {
                  const out = m.direction === "outbound";
                  return (
                    <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                      <div
                        className="max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm"
                        style={{
                          backgroundColor: out ? "var(--bubble-out)" : "var(--bubble-in)",
                          borderTopRightRadius: out ? 4 : undefined,
                          borderTopLeftRadius: !out ? 4 : undefined,
                        }}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.content}</p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <ChannelBadge channel={m.channel ?? "manual"} />
                          <p className="text-[10px] opacity-60">
                            {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={send} className="border-t bg-card p-3">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setDirection("outbound")}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  <ArrowUpRight className="h-3 w-3" /> Send
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("inbound")}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${direction === "inbound" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  <ArrowDownLeft className="h-3 w-3" /> Simulate inbound
                </button>
                <span className="ml-2 text-muted-foreground">Tone:</span>
                {(["polite", "sales", "urgent"] as Tone[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTone(t)}
                    className={`rounded-full px-2.5 py-1 capitalize ${tone === t ? "bg-primary/20 text-primary" : "bg-muted"}`}
                  >
                    {t}
                  </button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="ml-auto h-7 gap-1 text-xs"
                  disabled={generating}
                  onClick={generateFollowUp}
                >
                  <Wand2 className="h-3 w-3" />
                  {generating ? "Generating…" : "AI Follow-up"}
                </Button>
              </div>
              <div className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type a message…"
                  className="flex-1"
                  disabled={sending}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={suggesting || !active}
                  title="Quick AI suggestion"
                  onClick={async () => {
                    if (!active) return;
                    setSuggesting(true);
                    try {
                      const { suggestion } = await suggestFn({ data: { contactId: active.contact_id, tone } });
                      if (suggestion) setDraft(suggestion);
                      else toast.error("No suggestion returned");
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "AI failed");
                    } finally {
                      setSuggesting(false);
                    }
                  }}
                >
                  <Sparkles className="h-4 w-4" />
                </Button>
                <Button type="submit" disabled={!draft.trim() || sending}>
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
