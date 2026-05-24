import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { FileText, Plus, Trash2 } from "lucide-react";

export const Route = createFileRoute("/app/templates")({
  component: TemplatesPage,
});

type Tpl = { id: string; name: string; body: string; category: string };

function TemplatesPage() {
  const { businessId } = useAuth();
  const [list, setList] = useState<Tpl[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [category, setCategory] = useState("general");

  const load = () => {
    if (!businessId) return;
    supabase.from("message_templates").select("*").eq("business_id", businessId).order("created_at", { ascending: false })
      .then(({ data }) => setList((data as Tpl[]) ?? []));
  };
  useEffect(load, [businessId]);

  const add = async () => {
    if (!businessId || !name.trim() || !body.trim()) return;
    const { error } = await supabase.from("message_templates").insert({ business_id: businessId, name, body, category });
    if (error) return toast.error(error.message);
    setName(""); setBody(""); setCategory("general");
    toast.success("Template added");
    load();
  };
  const del = async (id: string) => {
    await supabase.from("message_templates").delete().eq("id", id);
    load();
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <h1 className="flex items-center gap-2 text-xl font-bold"><FileText className="h-5 w-5" /> Message templates</h1>

      <div className="space-y-2 rounded-2xl border bg-card p-4">
        <Input placeholder="Template name (e.g. Welcome)" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
        <Textarea rows={3} placeholder="Message body. Use {{name}} for contact name." value={body} onChange={(e) => setBody(e.target.value)} />
        <Button onClick={add} disabled={!name || !body}><Plus className="mr-1 h-4 w-4" /> Add template</Button>
      </div>

      <div className="space-y-2">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No templates yet.</p>
        ) : list.map((t) => (
          <div key={t.id} className="flex items-start gap-3 rounded-lg border bg-card p-3">
            <div className="flex-1">
              <p className="text-sm font-semibold">{t.name} <span className="text-xs text-muted-foreground">· {t.category}</span></p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{t.body}</p>
            </div>
            <button onClick={() => del(t.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
    </div>
  );
}
