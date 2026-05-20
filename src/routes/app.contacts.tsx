import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Phone, Search } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/app/contacts")({
  component: ContactsPage,
});

type Contact = { id: string; name: string; phone: string; created_at: string };

const schema = z.object({
  name: z.string().trim().min(1, "Name required").max(100),
  phone: z.string().trim().min(7, "Invalid phone").max(20).regex(/^[+0-9\s-]+$/, "Digits only"),
});

function ContactsPage() {
  const { businessId } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("contacts")
      .select("id,name,phone,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setContacts(data ?? []);
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

  const filtered = contacts.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.phone.includes(search),
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
          <Input className="pl-9" placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} />
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
                  <div>
                    <p className="font-medium">{c.name}</p>
                    <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                      <Phone className="h-3 w-3" /> {c.phone}
                    </p>
                  </div>
                  <button onClick={() => remove(c.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
