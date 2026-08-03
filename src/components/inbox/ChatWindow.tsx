import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft, Send, Paperclip, Sparkles, StickyNote, Check, UserCheck, RefreshCw, Loader2, FileText,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ContactAvatar } from "@/components/ContactAvatar";
import { EmojiPicker } from "@/components/EmojiPicker";
import { MediaLightbox } from "@/components/MediaLightbox";
import { MediaComposerPreview, detectMediaType, uploadWithProgress } from "@/components/MediaComposer";
import { SendTemplateModal } from "@/components/SendTemplateModal";
import { sendOutboundMessage } from "@/lib/messaging.functions";
import { createChatMediaUploadUrl } from "@/lib/media.functions";
import { suggestReply } from "@/lib/ai.functions";
import { MediaBubble } from "./MediaBubble";
import { InternalNotes } from "./InternalNotes";
import { CannedReplies } from "./CannedReplies";
import { LabelPicker } from "./LabelPicker";
import { AgentAvatar } from "./AgentAvatar";
import {
  STATUSES, dateLabel, memberLabel, sessionWindow, statusMeta,
  type ConversationStatus, type InboxConversation, type InboxMessage, type TeamMember,
} from "./inbox-types";

const PAGE = 40;

export function ChatWindow({
  conversation,
  members,
  userId,
  canWrite,
  role,
  canAssignOthers = false,
  onBack,
  onConversationChanged,
}: {
  conversation: InboxConversation;
  members: TeamMember[];
  userId: string | null;
  canWrite: boolean;
  role?: "admin" | "agent" | "viewer" | null;
  canAssignOthers?: boolean;
  onBack: () => void;
  onConversationChanged: (patch: Partial<InboxConversation>) => void;
}) {

  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [showNotes, setShowNotes] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{ path: string; kind: "image" | "video"; filename: string | null } | null>(null);
  const [typingAgents, setTypingAgents] = useState<string[]>([]);
  const [viewers, setViewers] = useState<string[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const presenceRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useServerFn(sendOutboundMessage);
  const uploadUrlFn = useServerFn(createChatMediaUploadUrl);
  const suggest = useServerFn(suggestReply);

  const me = members.find((m) => m.user_id === userId);
  const myName = me ? memberLabel(me) : "You";
  const assignee = members.find((m) => m.user_id === conversation.assigned_to);
  const window24 = sessionWindow(conversation.last_inbound_at);
  const status = statusMeta(conversation.status);

  // ---- messages ---------------------------------------------------------
  const loadMessages = useCallback(async () => {
    const { data } = await supabase
      .from("messages")
      .select("id,contact_id,conversation_id,direction,content,channel,created_at,media_url,media_type,media_mime,media_filename,media_size,reactions")
      .eq("contact_id", conversation.contact_id)
      .order("created_at", { ascending: false })
      .limit(PAGE);
    setMessages(((data as InboxMessage[]) ?? []).slice().reverse());
    setLoading(false);
  }, [conversation.contact_id]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    loadMessages();
  }, [loadMessages]);

  // Mark read on open
  useEffect(() => {
    if (conversation.unread_count > 0) {
      supabase.from("conversations").update({ unread_count: 0 }).eq("id", conversation.id).then(() => {
        onConversationChanged({ unread_count: 0 });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation.id]);

  // Realtime messages for this contact
  useEffect(() => {
    const ch = supabase
      .channel(`inbox-msgs-${conversation.contact_id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "messages", filter: `contact_id=eq.${conversation.contact_id}` },
        () => loadMessages(),
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversation.contact_id, loadMessages]);

  // Presence — collision detection ("Sarah is typing…" / who else is viewing)
  useEffect(() => {
    if (!userId) return;
    const ch = supabase.channel(`presence-conv-${conversation.id}`, {
      config: { presence: { key: userId } },
    });
    presenceRef.current = ch;
    const sync = () => {
      const state = ch.presenceState() as Record<string, Array<{ name: string; typing: boolean; uid: string }>>;
      const others = Object.entries(state)
        .filter(([key]) => key !== userId)
        .flatMap(([, entries]) => entries);
      setViewers([...new Set(others.map((o) => o.name))]);
      setTypingAgents([...new Set(others.filter((o) => o.typing).map((o) => o.name))]);
    };
    ch.on("presence", { event: "sync" }, sync)
      .subscribe(async (st) => {
        if (st === "SUBSCRIBED") await ch.track({ name: myName, typing: false, uid: userId });
      });
    return () => {
      presenceRef.current = null;
      supabase.removeChannel(ch);
    };
  }, [conversation.id, userId, myName]);

  const broadcastTyping = (typing: boolean) => {
    if (!userId) return;
    presenceRef.current?.track({ name: myName, typing, uid: userId });
  };

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.length, loading]);

  // ---- actions ----------------------------------------------------------
  const claim = async () => {
    if (!userId || !canWrite) return;

    const { data, error } = await supabase
      .from("conversations")
      .update({ assigned_to: userId, assigned_at: new Date().toISOString() })
      .eq("id", conversation.id)
      .is("assigned_to", null)
      .select("id,assigned_to,assigned_at");
    if (error) return toast.error(error.message);
    if (!data?.length) {
      toast.error("Someone else just claimed this conversation");
      const { data: fresh } = await supabase.from("conversations").select("assigned_to,assigned_at").eq("id", conversation.id).maybeSingle();
      if (fresh) onConversationChanged(fresh as Partial<InboxConversation>);
      return;
    }
    onConversationChanged({ assigned_to: userId, assigned_at: data[0].assigned_at });
    toast.success("Assigned to you");
  };

  const assignTo = async (value: string) => {
    if (!canWrite) return;
    const next = value === "unassigned" ? null : value;
    // Agents may only claim or release conversations for themselves.
    if (!canAssignOthers && next && next !== userId) {
      return toast.error("Only admins can assign conversations to other teammates");
    }
    if (!canAssignOthers && !next && conversation.assigned_to && conversation.assigned_to !== userId) {
      return toast.error("Only admins can unassign another teammate");
    }
    const { error } = await supabase
      .from("conversations")
      .update({ assigned_to: next, assigned_at: next ? new Date().toISOString() : null })
      .eq("id", conversation.id);
    if (error) return toast.error(error.message);
    onConversationChanged({ assigned_to: next });
  };

  const setStatus = async (value: ConversationStatus) => {
    if (!canWrite) return;
    const { error } = await supabase.from("conversations").update({ status: value }).eq("id", conversation.id);
    if (error) return toast.error(error.message);
    onConversationChanged({ status: value });
    toast.success(`Marked ${value}`);
  };


  const doSend = async () => {
    if (!canWrite) return;
    const body = text.trim();
    if (!body && !file) return;
    setSending(true);
    try {
      let media: { path: string; type: "image" | "video" | "audio" | "document"; mime?: string; filename?: string; size?: number } | undefined;
      if (file) {
        setUploading(true);
        setProgress(0);
        const { path, token } = await uploadUrlFn({ data: { contactId: conversation.contact_id, filename: file.name } });
        await uploadWithProgress({
          supabaseUrl: import.meta.env.VITE_SUPABASE_URL as string,
          bucket: "chat-media",
          path,
          token,
          file,
          onProgress: setProgress,
        });
        setUploading(false);
        media = { path, type: detectMediaType(file), mime: file.type, filename: file.name, size: file.size };
      }
      await send({ data: { contactId: conversation.contact_id, content: body, ...(media ? { media } : {}) } });
      setText("");
      setFile(null);
      setProgress(0);
      broadcastTyping(false);
      await loadMessages();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    } finally {
      setUploading(false);
      setSending(false);
    }
  };

  const aiSuggest = async () => {
    setAiBusy(true);
    try {
      const res = (await suggest({ data: { contactId: conversation.contact_id, tone: "polite" } })) as { suggestion?: string; reply?: string };
      const out = res.suggestion ?? res.reply ?? "";
      if (out) setText(out);
      else toast.error("No suggestion returned");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "AI failed");
    } finally {
      setAiBusy(false);
    }
  };

  const grouped = useMemo(() => {
    const out: Array<{ label: string; items: InboxMessage[] }> = [];
    for (const m of messages) {
      const label = dateLabel(m.created_at);
      const last = out[out.length - 1];
      if (last && last.label === label) last.items.push(m);
      else out.push({ label, items: [m] });
    }
    return out;
  }, [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Header */}
      <header className="border-b bg-card px-3 py-2.5">
        <div className="flex items-center gap-2">
          <button type="button" onClick={onBack} className="rounded-md p-1.5 hover:bg-muted lg:hidden" aria-label="Back to inbox">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <ContactAvatar name={conversation.contact.name} avatarUrl={conversation.contact.avatar_url} size={36} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{conversation.contact.name}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {conversation.contact.phone}
              {viewers.length > 0 && <span className="ml-1.5 text-primary">· {viewers.join(", ")} viewing</span>}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {conversation.assigned_to ? (
              <span className="hidden items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] sm:inline-flex">
                <AgentAvatar member={assignee} size={16} /> {memberLabel(assignee)}
              </span>
            ) : (
              canWrite && (
                <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={claim}>
                  <UserCheck className="h-3.5 w-3.5" /> Claim
                </Button>
              )
            )}
            <button
              type="button"
              onClick={() => setShowNotes((s) => !s)}
              className={`rounded-md p-2 transition ${showNotes ? "bg-amber-500/15 text-amber-600" : "hover:bg-muted"}`}
              title="Internal notes"
              aria-label="Internal notes"
            >
              <StickyNote className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Controls row */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Select value={conversation.status} onValueChange={(v) => setStatus(v as ConversationStatus)} disabled={!canWrite}>
            <SelectTrigger className="h-7 w-[112px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value} className="text-xs">{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={conversation.assigned_to ?? "unassigned"}
            onValueChange={assignTo}
            disabled={!canWrite || (!canAssignOthers && !!conversation.assigned_to && conversation.assigned_to !== userId)}
          >
            <SelectTrigger className="h-7 w-[140px] text-xs">
              <SelectValue placeholder="Assign" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned" className="text-xs">Unassigned</SelectItem>
              {members
                .filter((m) => m.user_id && (canAssignOthers || m.user_id === userId))
                .map((m) => (
                  <SelectItem key={m.id} value={m.user_id!} className="text-xs">{memberLabel(m)}</SelectItem>
                ))}
              {!canAssignOthers && userId && !members.some((m) => m.user_id === userId) && (
                <SelectItem value={userId} className="text-xs">Me</SelectItem>
              )}
            </SelectContent>
          </Select>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.chip}`}>{status.label}</span>
          {role === "viewer" && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">View only</span>
          )}

          <LabelPicker businessId={conversation.business_id} conversationId={conversation.id} canWrite={canWrite} compact />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Messages */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-3 overflow-y-auto bg-muted/25 px-3 py-4">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className={`flex ${i % 2 ? "justify-end" : "justify-start"}`}>
                  <div className="h-12 w-2/3 max-w-xs animate-pulse rounded-2xl bg-muted" />
                </div>
              ))
            ) : messages.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No messages yet.</p>
            ) : (
              grouped.map((group) => (
                <div key={group.label} className="space-y-2">
                  <div className="sticky top-0 z-[1] flex justify-center">
                    <span className="rounded-full bg-background/90 px-2.5 py-0.5 text-[10px] text-muted-foreground shadow-sm">
                      {group.label}
                    </span>
                  </div>
                  {group.items.map((m) => {
                    const out = m.direction === "outbound";
                    return (
                      <div key={m.id} className={`flex ${out ? "justify-end" : "justify-start"}`}>
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${
                            out ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-card"
                          }`}
                        >
                          <MediaBubble m={m} onOpenLightbox={(path, kind, filename) => setLightbox({ path, kind, filename })} />
                          {m.content && <p className="whitespace-pre-wrap break-words">{m.content}</p>}
                          <div className={`mt-0.5 flex items-center justify-end gap-1 text-[10px] ${out ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                            {new Date(m.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {out && <Check className="h-3 w-3" />}
                          </div>
                          {Array.isArray(m.reactions) && m.reactions.length > 0 && (
                            <div className="mt-1 flex gap-1">
                              {m.reactions.map((r, i) => (
                                <span key={i} className="rounded-full bg-background/80 px-1.5 text-xs">{r.emoji}</span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ))
            )}
            {typingAgents.length > 0 && (
              <p className="text-center text-[11px] italic text-primary">
                {typingAgents.join(", ")} {typingAgents.length > 1 ? "are" : "is"} typing…
              </p>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Composer */}
          <div className="border-t bg-card p-2.5">
            <div className={`mb-1.5 flex items-center justify-between gap-2 text-[11px] ${window24.open ? "text-muted-foreground" : "text-destructive"}`}>
              <span className="truncate">{window24.label}</span>
              {canWrite && (
                <button type="button" onClick={() => setTemplateOpen(true)} className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline">
                  <FileText className="h-3 w-3" /> Template
                </button>
              )}

            </div>

            {file && (
              <MediaComposerPreview
                file={file}
                progress={progress}
                uploading={uploading}
                sending={sending}
                onRemove={() => { setFile(null); setProgress(0); }}
              />
            )}

            {canWrite ? (
              <div className="flex items-end gap-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ""; }}
                />
                <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={() => fileRef.current?.click()} title="Attach">
                  <Paperclip className="h-4 w-4" />
                </Button>
                <div className="hidden sm:block"><EmojiPicker onPick={(e) => setText((t) => t + e)} /></div>
                <CannedReplies businessId={conversation.business_id} contactName={conversation.contact.name} onPick={(t) => setText(t)} />
                <Button type="button" variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={aiSuggest} disabled={aiBusy} title="AI suggest">
                  {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                </Button>
                <Textarea
                  value={text}
                  rows={1}
                  placeholder="Type a reply…"
                  className="max-h-32 min-h-9 flex-1 resize-none py-2 text-sm"
                  onChange={(e) => {
                    setText(e.target.value);
                    broadcastTyping(true);
                    if (typingTimer.current) clearTimeout(typingTimer.current);
                    typingTimer.current = setTimeout(() => broadcastTyping(false), 2500);
                  }}
                  onBlur={() => broadcastTyping(false)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); }
                  }}
                />
                <Button type="button" size="icon" className="h-9 w-9 shrink-0" onClick={doSend} disabled={sending || (!text.trim() && !file)}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            ) : (
              <p className="py-2 text-center text-xs text-muted-foreground">You have view-only access to this inbox.</p>
            )}
          </div>
        </div>

        {/* Notes panel */}
        {showNotes && (
          <aside className="absolute inset-0 z-20 w-full border-l bg-card lg:static lg:z-auto lg:w-80 lg:shrink-0">
            <div className="flex items-center justify-between border-b px-3 py-2 lg:hidden">
              <span className="text-sm font-medium">Notes</span>
              <Button size="sm" variant="ghost" onClick={() => setShowNotes(false)}>Close</Button>
            </div>
            <div className="h-[calc(100%-41px)] lg:h-full">
              <InternalNotes
                businessId={conversation.business_id}
                conversationId={conversation.id}
                members={members}
                canWrite={canWrite}
                userId={userId}
              />
            </div>
          </aside>
        )}
      </div>

      {lightbox && (
        <MediaLightbox path={lightbox.path} kind={lightbox.kind} filename={lightbox.filename} onClose={() => setLightbox(null)} />
      )}
      <SendTemplateModal
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        contactId={conversation.contact_id}
        contactName={conversation.contact.name}
        onSent={() => { setTemplateOpen(false); loadMessages(); }}
      />
      <RefreshHidden onRefresh={loadMessages} />
    </div>
  );
}

/** Tiny always-available refresh affordance for flaky mobile networks. */
function RefreshHidden({ onRefresh }: { onRefresh: () => void }) {
  return (
    <button
      type="button"
      onClick={onRefresh}
      className="fixed bottom-24 right-4 z-10 grid h-9 w-9 place-items-center rounded-full border bg-card shadow-md lg:hidden"
      aria-label="Refresh messages"
    >
      <RefreshCw className="h-4 w-4" />
    </button>
  );
}
