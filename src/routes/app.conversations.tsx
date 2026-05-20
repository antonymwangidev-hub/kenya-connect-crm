import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Send, ArrowDownLeft, ArrowUpRight, MessageCircle, Phone, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { sendOutboundMessage } from "@/lib/messaging.functions";
import { suggestFollowUp } from "@/lib/automation.functions";

export const Route = createFileRoute("/app/conversations")({
  component: ConversationsPage,
});

type Contact = { id: string; name: string; phone: string };
type Channel = "manual" | "whatsapp" | "sms";
type Message = {
  id: string;
  contact_id: string;
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

function ConversationsPage() {
  const { businessId } = useAuth();
  const sendFn = useServerFn(sendOutboundMessage);
  const suggestFn = useServerFn(suggestFollowUp);
  const [suggesting, setSuggesting] = useState(false);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!businessId) return;
    supabase
      .from("contacts")
      .select("id,name,phone")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) { toast.error(error.message); return; }
        setContacts(data ?? []);
        if (data && data.length > 0 && !activeId) setActiveId(data[0].id);
      });

    // Realtime: refresh contacts when new ones auto-created from inbound messages
    const ch = supabase
      .channel(`contacts-${businessId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "contacts", filter: `business_id=eq.${businessId}` },
        (payload) => {
          const c = payload.new as Contact;
          setContacts((prev) => (prev.some((x) => x.id === c.id) ? prev : [c, ...prev]));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [businessId]);

  useEffect(() => {
    if (!activeId) { setMessages([]); return; }
    let cancelled = false;
    supabase
      .from("messages")
      .select("*")
      .eq("contact_id", activeId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) { toast.error(error.message); return; }
        setMessages((data ?? []) as Message[]);
      });

    const channel = supabase
      .channel(`msg-${activeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `contact_id=eq.${activeId}` },
        (payload) => {
          setMessages((prev) => {
            const m = payload.new as Message;
            if (prev.some((x) => x.id === m.id)) return prev;
            return [...prev, m];
          });
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [activeId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeId || !draft.trim() || sending) return;
    const content = draft.trim();
    setDraft("");

    // Simulated inbound: write directly as manual
    if (direction === "inbound") {
      const { error } = await supabase.from("messages").insert({
        contact_id: activeId,
        direction: "inbound",
        content,
        channel: "manual",
      });
      if (error) toast.error(error.message);
      return;
    }

    // Real outbound: try WhatsApp -> SMS fallback via server fn
    setSending(true);
    try {
      const result = await sendFn({ data: { contactId: activeId, content } });
      toast.success(`Sent via ${result.channel}`);
    } catch (err) {
      // Fallback: still record as manual so the chat doesn't lose the message
      const msg = err instanceof Error ? err.message : "Send failed";
      toast.error(msg);
      await supabase.from("messages").insert({
        contact_id: activeId,
        direction: "outbound",
        content,
        channel: "manual",
      });
    } finally {
      setSending(false);
    }
  };

  const active = contacts.find((c) => c.id === activeId);

  return (
    <div className="flex h-[calc(100vh-0px)] md:h-screen">
      <aside className={`${active ? "hidden md:block" : "block"} w-full shrink-0 border-r bg-card md:max-w-xs`}>
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Inbox</h2>
          <p className="text-xs text-muted-foreground">{contacts.length} contact{contacts.length === 1 ? "" : "s"}</p>
        </div>
        <div className="overflow-y-auto">
          {contacts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No contacts yet. Incoming WhatsApp messages create them automatically, or add one from Contacts.</p>
          ) : (
            contacts.map((c) => {
              const isActive = c.id === activeId;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveId(c.id)}
                  className={`flex w-full items-center gap-3 border-b px-4 py-3 text-left transition ${
                    isActive ? "bg-accent" : "hover:bg-muted"
                  }`}
                >
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                    {c.name.slice(0, 1).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{c.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{c.phone}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </aside>

      <section className="flex flex-1 flex-col" style={{ backgroundColor: "var(--chat-bg)" }}>
        {!active ? (
          <div className="grid flex-1 place-items-center text-center text-muted-foreground">
            <div>
              <MessageCircle className="mx-auto h-10 w-10 opacity-40" />
              <p className="mt-3 text-sm">Select a contact to start chatting</p>
            </div>
          </div>
        ) : (
          <>
            <header className="flex items-center gap-3 border-b bg-card px-4 py-3">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-primary/15 text-sm font-semibold text-primary">
                {active.name.slice(0, 1).toUpperCase()}
              </div>
              <div>
                <p className="text-sm font-medium">{active.name}</p>
                <p className="text-xs text-muted-foreground">{active.phone}</p>
              </div>
            </header>

            <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto px-4 py-6">
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
              <div className="mb-2 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Mode:</span>
                <button
                  type="button"
                  onClick={() => setDirection("outbound")}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  <ArrowUpRight className="h-3 w-3" /> Send (WhatsApp→SMS)
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("inbound")}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${direction === "inbound" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  <ArrowDownLeft className="h-3 w-3" /> Simulate inbound
                </button>
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
                  title="AI suggest follow-up"
                  onClick={async () => {
                    if (!active) return;
                    setSuggesting(true);
                    try {
                      const { suggestion } = await suggestFn({ data: { contactId: active.id } });
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
