import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Phone, Search, Tag as TagIcon, X } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { toast } from "sonner";

export const Route = createFileRoute("/app/contacts")({
  component: ContactsPage,
});

type Tag = { id: string; name: string };
type Contact = {
  id: string;
  name: string;
  phone: string;
  created_at: string;
  tags: Tag[];
};

const schema = z.object({
  name: z.string().trim().min(1, "Name required").max(100),
  phone: z.string().trim().min(7, "Invalid phone").max(20).regex(/^[+0-9\s-]+$/, "Digits only"),
});

function ContactsPage() {
  const { businessId } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const [{ data: cdata, error: cerr }, { data: tdata, error: terr }] = await Promise.all([
      supabase
        .from("contacts")
        .select("id,name,phone,created_at,contact_tags(tag:tags(id,name))")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false }),
      supabase.from("tags").select("id,name").eq("business_id", businessId).order("name"),
    ]);
    if (cerr) toast.error(cerr.message);
    if (terr) toast.error(terr.message);
    const mapped: Contact[] = (cdata ?? []).map((c: { id: string; name: string; phone: string; created_at: string; contact_tags: { tag: Tag | null }[] }) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      created_at: c.created_at,
      tags: (c.contact_tags ?? []).map((ct) => ct.tag).filter((t): t is Tag => Boolean(t)),
    }));
    setContacts(mapped);
    setAllTags(tdata ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [businessId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    const parsed = schema.safeParse({ name, phone });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    const { error } = await supabase.from("contacts").insert({
      business_id: businessId,
      name: parsed.data.name,
      phone: parsed.data.phone,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Contact added");
    setName(""); setPhone(""); setOpen(false);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this contact and all its messages?")) return;
    const { error } = await supabase.from("contacts").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    toast.success("Deleted");
    load();
  };

  const toggleTag = async (contactId: string, tag: Tag, on: boolean) => {
    if (on) {
      const { error } = await supabase.from("contact_tags").insert({ contact_id: contactId, tag_id: tag.id });
      if (error) { toast.error(error.message); return; }
    } else {
      const { error } = await supabase
        .from("contact_tags")
        .delete()
        .eq("contact_id", contactId)
        .eq("tag_id", tag.id);
      if (error) { toast.error(error.message); return; }
    }
    setContacts((prev) =>
      prev.map((c) =>
        c.id === contactId
          ? { ...c, tags: on ? [...c.tags, tag] : c.tags.filter((t) => t.id !== tag.id) }
          : c,
      ),
    );
  };

  const createTag = async (rawName: string) => {
    if (!businessId) return;
    const tagName = rawName.trim();
    if (!tagName) return;
    const { data, error } = await supabase
      .from("tags")
      .insert({ business_id: businessId, name: tagName })
      .select("id,name")
      .single();
    if (error) { toast.error(error.message); return; }
    setAllTags((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
  };

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search) ||
      c.tags.some((t) => t.name.toLowerCase().includes(search.toLowerCase())),
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b bg-card px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">Contacts</h1>
          <p className="text-sm text-muted-foreground">Manage your customer list.</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="mr-1 h-4 w-4" /> New contact</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add a contact</DialogTitle></DialogHeader>
            <form onSubmit={add} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+254712345678" required />
              </div>
              <Button type="submit" className="w-full">Add contact</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="border-b bg-card px-6 py-3">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search by name, phone, or tag" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : filtered.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-12 text-center">
            <p className="text-sm text-muted-foreground">No contacts yet. Add your first one.</p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {filtered.map((c) => (
              <div key={c.id} className="rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <p className="font-medium">{c.name}</p>
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <Phone className="h-3 w-3" /> {c.phone}
                    </p>
                  </div>
                  <button onClick={() => remove(c.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  {c.tags.map((t) => (
                    <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
                      <TagIcon className="h-2.5 w-2.5" />
                      {t.name}
                      <button onClick={() => toggleTag(c.id, t, false)} className="text-primary/70 hover:text-destructive">
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </span>
                  ))}
                  <TagPicker
                    allTags={allTags}
                    selectedIds={new Set(c.tags.map((t) => t.id))}
                    onToggle={(tag, on) => toggleTag(c.id, tag, on)}
                    onCreate={createTag}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TagPicker({
  allTags,
  selectedIds,
  onToggle,
  onCreate,
}: {
  allTags: Tag[];
  selectedIds: Set<string>;
  onToggle: (tag: Tag, on: boolean) => void;
  onCreate: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const filtered = allTags.filter((t) => t.name.toLowerCase().includes(q.toLowerCase()));
  const exact = allTags.some((t) => t.name.toLowerCase() === q.trim().toLowerCase());
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted">
          <Plus className="h-2.5 w-2.5" /> Tag
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <Input
          autoFocus
          placeholder="Search or create tag…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="h-8"
        />
        <div className="mt-2 max-h-48 overflow-y-auto">
          {filtered.map((t) => {
            const on = selectedIds.has(t.id);
            return (
              <button
                key={t.id}
                onClick={() => onToggle(t, !on)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  <TagIcon className="h-3 w-3 text-primary" /> {t.name}
                </span>
                {on && <span className="text-xs text-primary">✓</span>}
              </button>
            );
          })}
          {q.trim() && !exact && (
            <button
              onClick={() => { onCreate(q); setQ(""); }}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-primary hover:bg-muted"
            >
              <Plus className="h-3 w-3" /> Create "{q.trim()}"
            </button>
          )}
          {filtered.length === 0 && !q.trim() && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">No tags yet</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
