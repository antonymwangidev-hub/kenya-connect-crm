import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Tag as TagIcon } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/app/tags")({
  component: TagsPage,
});

type Tag = { id: string; name: string };

const schema = z.object({ name: z.string().trim().min(1).max(40) });

function TagsPage() {
  const { businessId } = useAuth();
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("tags")
      .select("id,name")
      .eq("business_id", businessId)
      .order("name");
    if (error) toast.error(error.message);
    setTags(data ?? []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [businessId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    const parsed = schema.safeParse({ name });
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    const { error } = await supabase.from("tags").insert({ business_id: businessId, name: parsed.data.name });
    if (error) { toast.error(error.message); return; }
    setName("");
    load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("tags").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    load();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b bg-card px-6 py-4">
        <h1 className="text-xl font-semibold">Tags</h1>
        <p className="text-sm text-muted-foreground">Organize contacts with custom labels.</p>
      </div>
      <div className="flex-1 overflow-auto p-6">
        <form onSubmit={add} className="mb-6 flex max-w-md gap-2">
          <Input placeholder="New tag name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit"><Plus className="h-4 w-4" /></Button>
        </form>
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : tags.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-12 text-center text-sm text-muted-foreground">
            No tags yet.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <div key={t.id} className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm">
                <TagIcon className="h-3 w-3 text-primary" />
                <span>{t.name}</span>
                <button onClick={() => remove(t.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
