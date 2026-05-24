import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Bell, Plus, CheckCircle2, X } from "lucide-react";

export const Route = createFileRoute("/app/reminders")({
  component: RemindersPage,
});

type Reminder = { id: string; contact_id: string; due_at: string; note: string | null; status: string };
type Contact = { id: string; name: string; phone: string };

function RemindersPage() {
  const { businessId, user } = useAuth();
  const [list, setList] = useState<Reminder[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [contactId, setContactId] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");

  const load = () => {
    if (!businessId) return;
    supabase.from("reminders").select("*").eq("business_id", businessId).order("due_at", { ascending: true })
      .then(({ data }) => setList((data as Reminder[]) ?? []));
    supabase.from("contacts").select("id,name,phone").eq("business_id", businessId).order("name")
      .then(({ data }) => setContacts((data as Contact[]) ?? []));
  };
  useEffect(load, [businessId]);

  const add = async () => {
    if (!businessId || !user || !contactId || !dueAt) return;
    const { error } = await supabase.from("reminders").insert({
      business_id: businessId, contact_id: contactId,
      due_at: new Date(dueAt).toISOString(), note: note || null, created_by: user.id,
    });
    if (error) return toast.error(error.message);
    setContactId(""); setDueAt(""); setNote("");
    toast.success("Reminder set");
    load();
  };
  const setStatus = async (id: string, status: "done" | "cancelled") => {
    await supabase.from("reminders").update({ status }).eq("id", id);
    load();
  };

  const contactName = (id: string) => contacts.find((c) => c.id === id)?.name ?? "Unknown";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="flex items-center gap-2 text-xl font-bold"><Bell className="h-5 w-5" /> Reminders & follow-ups</h1>

      <div className="space-y-2 rounded-2xl border bg-card p-4">
        <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={contactId} onChange={(e) => setContactId(e.target.value)}>
          <option value="">Select contact…</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>)}
        </select>
        <Input type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
        <Textarea rows={2} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <Button onClick={add} disabled={!contactId || !dueAt}><Plus className="mr-1 h-4 w-4" /> Add reminder</Button>
      </div>

      <div className="space-y-2">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No reminders yet.</p>
        ) : list.map((r) => (
          <div key={r.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
            <div className="flex-1">
              <p className="text-sm font-semibold">{contactName(r.contact_id)}</p>
              <p className="text-xs text-muted-foreground">{new Date(r.due_at).toLocaleString()} · {r.status}</p>
              {r.note && <p className="mt-1 text-sm">{r.note}</p>}
            </div>
            {r.status === "pending" && (
              <div className="flex gap-1">
                <button onClick={() => setStatus(r.id, "done")} className="rounded p-1 hover:bg-muted" title="Done"><CheckCircle2 className="h-4 w-4 text-green-600" /></button>
                <button onClick={() => setStatus(r.id, "cancelled")} className="rounded p-1 hover:bg-muted" title="Cancel"><X className="h-4 w-4 text-muted-foreground" /></button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
