import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Zap } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export const Route = createFileRoute("/app/automations")({
  component: AutomationsPage,
});

type Trigger = "new_message" | "tag_added" | "time_delay";
type Action = "send_message" | "add_tag" | "notify_owner";

type Rule = {
  id: string;
  name: string;
  trigger: Trigger;
  action: Action;
  condition: Record<string, unknown>;
  action_payload: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
};

const triggerLabel: Record<Trigger, string> = {
  new_message: "When a new message arrives",
  tag_added: "When a tag is added to a contact",
  time_delay: "After a time delay with no reply",
};

const actionLabel: Record<Action, string> = {
  send_message: "Send a message",
  add_tag: "Add a tag",
  notify_owner: "Notify me",
};

function AutomationsPage() {
  const { businessId } = useAuth();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<Trigger>("new_message");
  const [action, setAction] = useState<Action>("send_message");
  const [condText, setCondText] = useState(""); // tag name, hours, or keyword
  const [actionText, setActionText] = useState(""); // message body / tag name

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("automation_rules")
      .select("*")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    setRules((data as Rule[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [businessId]);

  const reset = () => {
    setName("");
    setTrigger("new_message");
    setAction("send_message");
    setCondText("");
    setActionText("");
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    if (!name.trim()) return toast.error("Name required");

    const condition: Record<string, unknown> =
      trigger === "tag_added"
        ? { tag: condText.trim() }
        : trigger === "time_delay"
          ? { hours: Number(condText) || 24 }
          : { keyword: condText.trim() || null };

    const action_payload: Record<string, unknown> =
      action === "send_message"
        ? { message: actionText.trim() }
        : action === "add_tag"
          ? { tag: actionText.trim() }
          : { note: actionText.trim() };

    const { error } = await supabase.from("automation_rules").insert({
      business_id: businessId,
      name: name.trim(),
      trigger,
      action,
      condition,
      action_payload,
    });
    if (error) return toast.error(error.message);
    toast.success("Rule created");
    reset();
    setOpen(false);
    load();
  };

  const toggle = async (id: string, is_active: boolean) => {
    const { error } = await supabase
      .from("automation_rules")
      .update({ is_active })
      .eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this rule?")) return;
    const { error } = await supabase.from("automation_rules").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-card px-6 py-4">
        <div>
          <h1 className="text-xl font-semibold">Automations</h1>
          <p className="text-sm text-muted-foreground">
            Save time with simple if-this-then-that rules.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-1 h-4 w-4" /> New rule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create automation rule</DialogTitle>
            </DialogHeader>
            <form onSubmit={add} className="space-y-4">
              <div className="space-y-1.5">
                <Label>Rule name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Follow up interested leads"
                />
              </div>
              <div className="space-y-1.5">
                <Label>When</Label>
                <Select value={trigger} onValueChange={(v) => setTrigger(v as Trigger)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(triggerLabel) as Trigger[]).map((t) => (
                      <SelectItem key={t} value={t}>
                        {triggerLabel[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>
                  {trigger === "tag_added"
                    ? "Tag name"
                    : trigger === "time_delay"
                      ? "Hours without reply"
                      : "Optional keyword in message"}
                </Label>
                <Input
                  value={condText}
                  onChange={(e) => setCondText(e.target.value)}
                  placeholder={
                    trigger === "tag_added"
                      ? "interested"
                      : trigger === "time_delay"
                        ? "24"
                        : "price"
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Then</Label>
                <Select value={action} onValueChange={(v) => setAction(v as Action)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(actionLabel) as Action[]).map((a) => (
                      <SelectItem key={a} value={a}>
                        {actionLabel[a]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>
                  {action === "send_message"
                    ? "Message to send"
                    : action === "add_tag"
                      ? "Tag to add"
                      : "Note"}
                </Label>
                <Textarea
                  value={actionText}
                  onChange={(e) => setActionText(e.target.value)}
                  rows={3}
                />
              </div>
              <Button type="submit" className="w-full">
                Create rule
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : rules.length === 0 ? (
          <div className="rounded-lg border border-dashed bg-card p-12 text-center">
            <Zap className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              No automations yet. Create your first rule.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((r) => (
              <div
                key={r.id}
                className="flex items-start justify-between rounded-lg border bg-card p-4"
              >
                <div className="space-y-1">
                  <p className="font-medium">{r.name}</p>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-foreground">When:</span> {triggerLabel[r.trigger]}
                    {JSON.stringify(r.condition) !== "{}" && (
                      <span className="ml-1 text-xs">
                        ({Object.values(r.condition).join(", ")})
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    <span className="text-foreground">Then:</span> {actionLabel[r.action]}
                    {JSON.stringify(r.action_payload) !== "{}" && (
                      <span className="ml-1 text-xs">
                        — {Object.values(r.action_payload).join(", ")}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    checked={r.is_active}
                    onCheckedChange={(v) => toggle(r.id, v)}
                  />
                  <button
                    onClick={() => remove(r.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
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
