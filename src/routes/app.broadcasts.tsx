import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Megaphone, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { sendBroadcast } from "@/lib/automation.functions";

export const Route = createFileRoute("/app/broadcasts")({
  component: BroadcastsPage,
});

type Contact = { id: string; name: string; phone: string };
type Broadcast = {
  id: string;
  name: string;
  content: string;
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
};

function BroadcastsPage() {
  const { businessId } = useAuth();
  const sendFn = useServerFn(sendBroadcast);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);

  const load = async () => {
    if (!businessId) return;
    const [{ data: cs }, { data: bs }] = await Promise.all([
      supabase
        .from("contacts")
        .select("id,name,phone")
        .eq("business_id", businessId)
        .order("name"),
      supabase
        .from("broadcasts")
        .select("*")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);
    setContacts(cs ?? []);
    setHistory((bs as Broadcast[]) ?? []);
  };

  useEffect(() => {
    load();
  }, [businessId]);

  const toggleAll = () => {
    if (selected.size === contacts.length) setSelected(new Set());
    else setSelected(new Set(contacts.map((c) => c.id)));
  };

  const toggleOne = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const send = async () => {
    if (!name.trim() || !content.trim() || selected.size === 0) {
      return toast.error("Add a name, message, and at least one recipient");
    }
    setSending(true);
    try {
      const res = await sendFn({
        data: { name: name.trim(), content: content.trim(), contactIds: [...selected] },
      });
      toast.success(`Sent ${res.sent}, failed ${res.failed}`);
      setName("");
      setContent("");
      setSelected(new Set());
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Broadcast failed");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="border-b bg-card px-6 py-4">
        <h1 className="text-xl font-semibold">Broadcasts</h1>
        <p className="text-sm text-muted-foreground">
          Send the same message to many contacts at once.
        </p>
      </div>

      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-lg border bg-card p-5">
          <div className="space-y-1.5">
            <Label>Campaign name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekend promo"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Message</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={5}
              placeholder="Hi! We have a special offer this weekend…"
            />
            <p className="text-xs text-muted-foreground">{content.length} characters</p>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Recipients ({selected.size} selected)</Label>
              <button
                type="button"
                onClick={toggleAll}
                className="text-xs text-primary hover:underline"
              >
                {selected.size === contacts.length ? "Clear all" : "Select all"}
              </button>
            </div>
            <div className="max-h-64 overflow-auto rounded-md border">
              {contacts.length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No contacts yet.</p>
              ) : (
                contacts.map((c) => (
                  <label
                    key={c.id}
                    className="flex cursor-pointer items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selected.has(c.id)}
                      onCheckedChange={() => toggleOne(c.id)}
                    />
                    <span className="flex-1">{c.name}</span>
                    <span className="text-xs text-muted-foreground">{c.phone}</span>
                  </label>
                ))
              )}
            </div>
          </div>
          <Button onClick={send} disabled={sending} className="w-full">
            <Megaphone className="mr-1 h-4 w-4" />
            {sending ? "Sending…" : `Send to ${selected.size} contacts`}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Rate-limited at ~3 messages/sec to avoid spam blocks.
          </p>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-medium">Recent broadcasts</h2>
          {history.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
              No broadcasts sent yet.
            </div>
          ) : (
            history.map((b) => (
              <div key={b.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-medium">{b.name}</p>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {b.content}
                    </p>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-emerald-600">
                    <Check className="h-3 w-3" /> {b.sent_count}/{b.total_recipients}
                  </span>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {new Date(b.created_at).toLocaleString()}
                  {b.failed_count > 0 && (
                    <span className="ml-2 text-destructive">
                      {b.failed_count} failed
                    </span>
                  )}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
