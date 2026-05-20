import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Clock, DollarSign, Target } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/app/performance")({ component: PerformancePage });

type Revenue = { id: string; amount: number; currency: string; note: string | null; occurred_at: string };

function PerformancePage() {
  const { businessId } = useAuth();
  const [contacts, setContacts] = useState<{ id: string; stage: string }[]>([]);
  const [messages, setMessages] = useState<{ contact_id: string; direction: string; created_at: string }[]>([]);
  const [revenues, setRevenues] = useState<Revenue[]>([]);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");

  const load = async () => {
    if (!businessId) return;
    const [{ data: c }, { data: r }] = await Promise.all([
      supabase.from("contacts").select("id,stage").eq("business_id", businessId),
      supabase.from("revenue_entries").select("*").eq("business_id", businessId).order("occurred_at", { ascending: false }),
    ]);
    setContacts(c ?? []);
    setRevenues((r ?? []) as Revenue[]);
    const ids = (c ?? []).map((x) => x.id);
    if (ids.length) {
      const { data: m } = await supabase.from("messages").select("contact_id,direction,created_at").in("contact_id", ids);
      setMessages(m ?? []);
    } else setMessages([]);
  };

  useEffect(() => { load(); }, [businessId]);

  const addRevenue = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId || !amount) return;
    const n = parseFloat(amount);
    if (isNaN(n) || n < 0) { toast.error("Invalid amount"); return; }
    const { error } = await supabase.from("revenue_entries").insert({
      business_id: businessId, amount: n, currency: "KES", note: note || null,
    });
    if (error) { toast.error(error.message); return; }
    setAmount(""); setNote(""); toast.success("Revenue logged");
    load();
  };

  const total = contacts.length;
  const paid = contacts.filter((c) => c.stage === "paid").length;
  const conversion = total ? Math.round((paid / total) * 100) : 0;

  // Average response time: time between an inbound and the next outbound from same contact
  let totalMs = 0, pairs = 0;
  const byContact = new Map<string, typeof messages>();
  for (const m of messages) {
    const arr = byContact.get(m.contact_id) ?? [];
    arr.push(m);
    byContact.set(m.contact_id, arr);
  }
  for (const [, arr] of byContact) {
    arr.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i].direction === "inbound" && arr[i + 1].direction === "outbound") {
        totalMs += new Date(arr[i + 1].created_at).getTime() - new Date(arr[i].created_at).getTime();
        pairs++;
      }
    }
  }
  const avgMin = pairs ? Math.round(totalMs / pairs / 60000) : 0;
  const revenueTotal = revenues.reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /> Performance</h1>
          <p className="text-sm text-muted-foreground">Conversion, response time, revenue.</p>
        </header>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Target} label="Conversion" value={`${conversion}%`} sub={`${paid}/${total} paid`} />
          <Stat icon={Clock} label="Avg response" value={pairs ? `${avgMin}m` : "—"} sub={`${pairs} replies`} />
          <Stat icon={DollarSign} label="Revenue" value={`KES ${revenueTotal.toLocaleString()}`} sub={`${revenues.length} entries`} />
          <Stat icon={TrendingUp} label="Contacts" value={`${total}`} sub="total" />
        </div>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Log revenue</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={addRevenue} className="flex flex-col gap-2 sm:flex-row">
              <Input type="number" inputMode="decimal" placeholder="Amount (KES)" value={amount} onChange={(e) => setAmount(e.target.value)} className="sm:w-40" />
              <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} className="flex-1" />
              <Button type="submit">Add</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">Recent revenue</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {revenues.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing yet. Log a sale above.</p>
            ) : revenues.slice(0, 10).map((r) => (
              <div key={r.id} className="flex items-center justify-between border-b pb-2 text-sm">
                <div>
                  <p className="font-medium">{r.currency} {Number(r.amount).toLocaleString()}</p>
                  {r.note && <p className="text-xs text-muted-foreground">{r.note}</p>}
                </div>
                <p className="text-xs text-muted-foreground">{new Date(r.occurred_at).toLocaleDateString()}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Stat({ icon: Icon, label, value, sub }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; sub: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" /> {label}</div>
        <p className="mt-1 text-2xl font-semibold">{value}</p>
        <p className="text-xs text-muted-foreground">{sub}</p>
      </CardContent>
    </Card>
  );
}
