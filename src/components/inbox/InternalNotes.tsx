import { useEffect, useRef, useState } from "react";
import { StickyNote, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { AgentAvatar } from "./AgentAvatar";
import { memberLabel, timeAgo, type TeamMember } from "./inbox-types";

type Note = { id: string; body: string; author_id: string; created_at: string };

export function InternalNotes({
  businessId,
  conversationId,
  members,
  canWrite,
  userId,
}: {
  businessId: string;
  conversationId: string;
  members: TeamMember[];
  canWrite: boolean;
  userId: string | null;
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data } = await supabase
      .from("conversation_notes")
      .select("id,body,author_id,created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });
    setNotes((data as Note[]) ?? []);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`notes-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversation_notes", filter: `conversation_id=eq.${conversationId}` },
        () => load(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [notes.length]);

  const add = async () => {
    const text = body.trim();
    if (!text || !userId) return;
    setSaving(true);
    const { error } = await supabase.from("conversation_notes").insert({
      conversation_id: conversationId,
      business_id: businessId,
      author_id: userId,
      body: text,
    });
    setSaving(false);
    if (error) return toast.error(error.message);
    setBody("");
    load();
  };

  const authorFor = (id: string) => members.find((m) => m.user_id === id);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-400">
        <StickyNote className="h-3.5 w-3.5" />
        Internal notes — only your team can see these
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {notes.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">No notes yet. Leave context for your teammates.</p>
        )}
        {notes.map((n) => {
          const author = authorFor(n.author_id);
          return (
            <div key={n.id} className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-2.5">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <AgentAvatar member={author} size={16} />
                <span className="font-medium text-foreground">
                  {author ? memberLabel(author) : n.author_id === userId ? "You" : "Teammate"}
                </span>
                <span>· {timeAgo(n.created_at)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-sm">{n.body}</p>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
      {canWrite && (
        <div className="border-t p-2.5">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            placeholder="Add an internal note (not sent to the customer)…"
            className="mb-2 resize-none text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); }
            }}
          />
          <Button size="sm" className="w-full gap-1.5" disabled={!body.trim() || saving} onClick={add}>
            <Send className="h-3.5 w-3.5" /> {saving ? "Saving…" : "Add note"}
          </Button>
        </div>
      )}
    </div>
  );
}
