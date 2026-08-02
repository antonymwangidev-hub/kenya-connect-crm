import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

type Template = { id: string; name: string; body: string; category: string | null };

export function CannedReplies({
  businessId,
  contactName,
  onPick,
}: {
  businessId: string;
  contactName: string;
  onPick: (text: string) => void;
}) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    supabase
      .from("message_templates")
      .select("id,name,body,category")
      .eq("business_id", businessId)
      .order("name")
      .then(({ data }) => setTemplates((data as Template[]) ?? []));
  }, [businessId, open]);

  const filtered = templates.filter(
    (t) => t.name.toLowerCase().includes(q.toLowerCase()) || t.body.toLowerCase().includes(q.toLowerCase()),
  );

  const fill = (body: string) => body.replace(/\{\{\s*name\s*\}\}/gi, contactName);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" title="Canned replies">
          <Zap className="h-3.5 w-3.5" /> <span className="hidden sm:inline">Canned</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search canned replies…"
          className="mb-2 w-full rounded-md border bg-background px-2 py-1.5 text-xs outline-none"
        />
        <div className="max-h-64 space-y-1 overflow-y-auto">
          {filtered.length === 0 && (
            <p className="px-1 py-4 text-center text-xs text-muted-foreground">
              No canned replies. Create them in Templates.
            </p>
          )}
          {filtered.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => { onPick(fill(t.body)); setOpen(false); }}
              className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
            >
              <p className="text-xs font-medium">{t.name}</p>
              <p className="line-clamp-2 text-[11px] text-muted-foreground">{t.body}</p>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
