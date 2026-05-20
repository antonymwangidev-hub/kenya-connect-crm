import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Phone } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/app/pipeline")({
  component: PipelinePage,
});

const STAGES = [
  { id: "new", label: "New", color: "bg-slate-500" },
  { id: "interested", label: "Interested", color: "bg-blue-500" },
  { id: "negotiation", label: "Negotiation", color: "bg-amber-500" },
  { id: "paid", label: "Paid", color: "bg-emerald-500" },
  { id: "lost", label: "Lost", color: "bg-rose-500" },
] as const;
type Stage = (typeof STAGES)[number]["id"];

type Contact = { id: string; name: string; phone: string; stage: Stage };

function PipelinePage() {
  const { businessId } = useAuth();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);

  const load = async () => {
    if (!businessId) return;
    const { data, error } = await supabase
      .from("contacts")
      .select("id,name,phone,stage")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setContacts((data as Contact[]) ?? []);
  };

  useEffect(() => {
    load();
  }, [businessId]);

  const moveTo = async (id: string, stage: Stage) => {
    const prev = contacts;
    setContacts((cs) => cs.map((c) => (c.id === id ? { ...c, stage } : c)));
    const { error } = await supabase
      .from("contacts")
      .update({ stage })
      .eq("id", id);
    if (error) {
      setContacts(prev);
      toast.error(error.message);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-card px-6 py-4">
        <h1 className="text-xl font-semibold">Lead pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Drag a contact between stages to update their status.
        </p>
      </div>

      <div className="flex-1 overflow-x-auto p-4">
        <div className="grid min-w-[900px] gap-3 md:grid-cols-5">
          {STAGES.map((s) => {
            const list = contacts.filter((c) => c.stage === s.id);
            return (
              <div
                key={s.id}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (dragging) moveTo(dragging, s.id);
                  setDragging(null);
                }}
                className="flex flex-col rounded-lg border bg-muted/30 p-3"
              >
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${s.color}`} />
                    <h2 className="text-sm font-medium">{s.label}</h2>
                  </div>
                  <span className="text-xs text-muted-foreground">{list.length}</span>
                </div>
                <div className="flex-1 space-y-2">
                  {list.map((c) => (
                    <div
                      key={c.id}
                      draggable
                      onDragStart={() => setDragging(c.id)}
                      onDragEnd={() => setDragging(null)}
                      className="cursor-grab rounded-md border bg-card p-3 shadow-sm active:cursor-grabbing"
                    >
                      <p className="text-sm font-medium">{c.name}</p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        {c.phone}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {STAGES.filter((x) => x.id !== c.stage).map((x) => (
                          <button
                            key={x.id}
                            onClick={() => moveTo(c.id, x.id)}
                            className="rounded border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                          >
                            → {x.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
