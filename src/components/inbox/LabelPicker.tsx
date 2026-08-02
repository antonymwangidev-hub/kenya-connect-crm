import { useEffect, useState } from "react";
import { Tag as TagIcon, Plus, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";

type Tag = { id: string; name: string };

export function LabelPicker({
  businessId,
  conversationId,
  canWrite,
  compact,
}: {
  businessId: string;
  conversationId: string;
  canWrite: boolean;
  compact?: boolean;
}) {
  const [tags, setTags] = useState<Tag[]>([]);
  const [applied, setApplied] = useState<string[]>([]);
  const [newLabel, setNewLabel] = useState("");
  const [open, setOpen] = useState(false);

  const loadTags = async () => {
    const { data } = await supabase.from("tags").select("id,name").eq("business_id", businessId).order("name");
    setTags((data as Tag[]) ?? []);
  };

  const loadApplied = async () => {
    const { data } = await supabase.from("conversation_labels").select("tag_id").eq("conversation_id", conversationId);
    setApplied((data ?? []).map((r) => r.tag_id));
  };

  useEffect(() => { loadTags(); }, [businessId]);
  useEffect(() => {
    loadApplied();
    const ch = supabase
      .channel(`labels-${conversationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "conversation_labels", filter: `conversation_id=eq.${conversationId}` }, () => loadApplied())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [conversationId]);

  const toggle = async (tagId: string) => {
    if (!canWrite) return;
    if (applied.includes(tagId)) {
      setApplied((p) => p.filter((t) => t !== tagId));
      const { error } = await supabase.from("conversation_labels").delete().eq("conversation_id", conversationId).eq("tag_id", tagId);
      if (error) { toast.error(error.message); loadApplied(); }
    } else {
      setApplied((p) => [...p, tagId]);
      const { error } = await supabase.from("conversation_labels").insert({ conversation_id: conversationId, tag_id: tagId });
      if (error) { toast.error(error.message); loadApplied(); }
    }
  };

  const createLabel = async () => {
    const name = newLabel.trim();
    if (!name) return;
    const { data, error } = await supabase.from("tags").insert({ business_id: businessId, name }).select("id,name").single();
    if (error) return toast.error(error.message);
    setNewLabel("");
    setTags((p) => [...p, data as Tag].sort((a, b) => a.name.localeCompare(b.name)));
    await toggle((data as Tag).id);
  };

  const appliedTags = tags.filter((t) => applied.includes(t.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {appliedTags.map((t) => (
        <span key={t.id} className="inline-flex items-center gap-1 rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-medium text-primary">
          {t.name}
          {canWrite && (
            <button type="button" onClick={() => toggle(t.id)} aria-label={`Remove ${t.name}`}>
              <X className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {canWrite && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
            >
              <TagIcon className="h-3 w-3" /> {compact ? "" : "Label"}
              <Plus className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-56 p-2">
            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {tags.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No labels yet.</p>}
              {tags.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggle(t.id)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted ${applied.includes(t.id) ? "font-medium text-primary" : ""}`}
                >
                  {t.name}
                  {applied.includes(t.id) && <X className="h-3 w-3" />}
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-1 border-t pt-2">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createLabel(); } }}
                placeholder="New label"
                className="h-8 text-xs"
              />
              <Button type="button" size="sm" className="h-8" onClick={createLabel}>Add</Button>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
