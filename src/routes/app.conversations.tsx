import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Send, ArrowDownLeft, ArrowUpRight, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/app/conversations")({
  component: ConversationsPage,
});

type Contact = { id: string; name: string; phone: string };
type Message = {
  id: string;
  contact_id: string;
  direction: "inbound" | "outbound";
  content: string;
  created_at: string;
};

function ConversationsPage() {
  const { businessId } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [direction, setDirection] = useState<"outbound" | "inbound">("outbound");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load contacts
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
  }, [businessId]);

  // Load messages for active contact + realtime
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
    if (!activeId || !draft.trim()) return;
    const content = draft.trim();
    setDraft("");
    const { error } = await supabase.from("messages").insert({
      contact_id: activeId,
      direction,
      content,
    });
    if (error) toast.error(error.message);
  };

  const active = contacts.find((c) => c.id === activeId);

  return (
    <div className="flex h-[calc(100vh-0px)] md:h-screen">
      {/* Contact list */}
      <aside className="w-full max-w-xs shrink-0 border-r bg-card md:block" style={{ display: active && window.innerWidth < 768 ? "none" : undefined }}>
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Chats</h2>
          <p className="text-xs text-muted-foreground">{contacts.length} contact{contacts.length === 1 ? "" : "s"}</p>
        </div>
        <div className="overflow-y-auto">
          {contacts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No contacts yet. Add one from the Contacts page.</p>
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

      {/* Chat area */}
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
                        <p className="mt-1 text-[10px] opacity-60">
                          {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form onSubmit={send} className="border-t bg-card p-3">
              <div className="mb-2 flex items-center gap-2 text-xs">
                <span className="text-muted-foreground">Simulate as:</span>
                <button
                  type="button"
                  onClick={() => setDirection("outbound")}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${direction === "outbound" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  <ArrowUpRight className="h-3 w-3" /> You
                </button>
                <button
                  type="button"
                  onClick={() => setDirection("inbound")}
                  className={`flex items-center gap-1 rounded-full px-2.5 py-1 ${direction === "inbound" ? "bg-primary text-primary-foreground" : "bg-muted"}`}
                >
                  <ArrowDownLeft className="h-3 w-3" /> Customer
                </button>
              </div>
              <div className="flex gap-2">
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type a message…"
                  className="flex-1"
                />
                <Button type="submit" disabled={!draft.trim()}>
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
