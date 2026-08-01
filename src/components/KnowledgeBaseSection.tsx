import { useCallback, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { BookOpen, Plus, Trash2, Pencil, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  listKnowledgeEntries,
  saveKnowledgeEntry,
  deleteKnowledgeEntry,
  KNOWLEDGE_CATEGORIES,
  type KnowledgeEntry,
} from "@/lib/ai-knowledge.functions";

type Draft = {
  id: string | null;
  title: string;
  category: string;
  content: string;
  keywords: string;
  priority: number;
  is_active: boolean;
};

const emptyDraft = (): Draft => ({
  id: null,
  title: "",
  category: "general",
  content: "",
  keywords: "",
  priority: 0,
  is_active: true,
});

export function KnowledgeBaseSection() {
  const listFn = useServerFn(listKnowledgeEntries);
  const saveFn = useServerFn(saveKnowledgeEntry);
  const deleteFn = useServerFn(deleteKnowledgeEntry);

  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { entries } = await listFn();
      setEntries(entries);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load knowledge base");
    } finally {
      setLoading(false);
    }
  }, [listFn]);

  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) return toast.error("Give this entry a title");
    if (!draft.content.trim()) return toast.error("Add some content the AI can read");
    setSaving(true);
    try {
      await saveFn({
        data: {
          id: draft.id,
          title: draft.title.trim(),
          category: draft.category,
          content: draft.content,
          keywords: draft.keywords,
          priority: draft.priority,
          is_active: draft.is_active,
        },
      });
      toast.success(draft.id ? "Entry updated" : "Entry added");
      setDraft(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (entry: KnowledgeEntry) => {
    if (!confirm(`Delete "${entry.title}"?`)) return;
    try {
      await deleteFn({ data: { id: entry.id } });
      setEntries((rows) => rows.filter((r) => r.id !== entry.id));
      toast.success("Entry deleted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  const toggleActive = async (entry: KnowledgeEntry, value: boolean) => {
    setEntries((rows) => rows.map((r) => (r.id === entry.id ? { ...r, is_active: value } : r)));
    try {
      await saveFn({
        data: {
          id: entry.id,
          title: entry.title,
          category: entry.category,
          content: entry.content,
          keywords: entry.keywords ?? "",
          priority: entry.priority,
          is_active: value,
        },
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
      void load();
    }
  };

  const q = query.trim().toLowerCase();
  const visible = q
    ? entries.filter((e) =>
        [e.title, e.category, e.content, e.keywords ?? ""].join(" ").toLowerCase().includes(q),
      )
    : entries;

  const activeCount = entries.filter((e) => e.is_active).length;

  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <BookOpen className="h-4 w-4" /> AI Knowledge Base
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Add everything the AI should know — products, prices, policies, delivery, payments, FAQs.
            The assistant answers customers strictly from these entries.
          </p>
        </div>
        <Button size="sm" onClick={() => setDraft(emptyDraft())}>
          <Plus className="mr-1 h-4 w-4" /> Add entry
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span>{entries.length} entries · {activeCount} active</span>
        {entries.length > 3 && (
          <Input
            className="h-8 max-w-xs"
            placeholder="Search knowledge…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        )}
      </div>

      {draft && (
        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-medium">{draft.id ? "Edit entry" : "New entry"}</h3>
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Title</Label>
              <Input
                placeholder="e.g. Delivery policy for Nairobi"
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <div>
              <Label>Category</Label>
              <select
                className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                value={draft.category}
                onChange={(e) => setDraft({ ...draft, category: e.target.value })}
              >
                {KNOWLEDGE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <Label>Content the AI can quote</Label>
            <Textarea
              rows={8}
              placeholder={"Write full, factual details.\n\nExample:\nWe deliver within Nairobi CBD for KES 200, same day if ordered before 3pm. Outside Nairobi we use G4S, 1–2 days, KES 350. We do not deliver on Sundays."}
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              {draft.content.length.toLocaleString()} / 50,000 characters
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Keywords (optional)</Label>
              <Input
                placeholder="delivery, shipping, courier"
                value={draft.keywords}
                onChange={(e) => setDraft({ ...draft, keywords: e.target.value })}
              />
            </div>
            <div>
              <Label>Priority (higher wins conflicts)</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={draft.priority}
                onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 0 })}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch
                checked={draft.is_active}
                onCheckedChange={(v) => setDraft({ ...draft, is_active: v })}
              />
              Active (AI can use this)
            </label>
            <Button onClick={save} disabled={saving}>
              {saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {draft.id ? "Update entry" : "Add entry"}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid place-items-center py-8 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {entries.length === 0
            ? "No knowledge yet. Add your first entry so the AI can answer from real business data."
            : "No entries match your search."}
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((e) => (
            <div key={e.id} className="rounded-xl border bg-background p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="truncate text-sm font-medium">{e.title}</h4>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
                      {e.category}
                    </span>
                    {!e.is_active && (
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-700 dark:text-amber-400">
                        inactive
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground">
                    {e.content}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Switch checked={e.is_active} onCheckedChange={(v) => toggleActive(e, v)} />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setDraft({
                        id: e.id,
                        title: e.title,
                        category: e.category,
                        content: e.content,
                        keywords: e.keywords ?? "",
                        priority: e.priority,
                        is_active: e.is_active,
                      })
                    }
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => remove(e)}>
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
