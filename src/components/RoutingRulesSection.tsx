import { useEffect, useState } from "react";
import { Plus, Route as RouteIcon, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export type RoutingRule = {
  id: string;
  name: string;
  min_score: number;
  max_score: number;
  stages: string[];
  assign_strategy: "fixed" | "round_robin" | "none";
  assign_to_user_id: string | null;
  team: string | null;
  create_task: boolean;
  task_hours: number;
  task_note: string | null;
  send_message: boolean;
  message_body: string | null;
  priority: number;
  dry_run: boolean;
  is_active: boolean;
};

type Member = { user_id: string | null; email: string; display_name: string | null; role: string };

const STAGES = ["new", "interested", "negotiation", "paid", "lost"];

export function RoutingRulesSection() {
  const { businessId, canWrite } = useAuth();
  const [rules, setRules] = useState<RoutingRule[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [minScore, setMinScore] = useState(70);
  const [maxScore, setMaxScore] = useState(100);
  const [stages, setStages] = useState<string[]>([]);
  const [strategy, setStrategy] = useState<"fixed" | "round_robin" | "none">("round_robin");
  const [assignee, setAssignee] = useState<string>("");
  const [createTask, setCreateTask] = useState(true);
  const [taskHours, setTaskHours] = useState(4);
  const [taskNote, setTaskNote] = useState("");
  const [sendMessage, setSendMessage] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [priority, setPriority] = useState(100);
  const [dryRun, setDryRun] = useState(true);

  const load = async () => {
    if (!businessId) return;
    setLoading(true);
    const [{ data: r, error }, { data: m }] = await Promise.all([
      supabase
        .from("routing_rules")
        .select("*")
        .eq("business_id", businessId)
        .order("priority"),
      supabase
        .from("business_members")
        .select("user_id,email,display_name,role")
        .eq("business_id", businessId),
    ]);
    if (error) toast.error(error.message);
    setRules((r as RoutingRule[]) ?? []);
    setMembers((m as Member[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, [businessId]);

  const reset = () => {
    setName("");
    setMinScore(70);
    setMaxScore(100);
    setStages([]);
    setStrategy("round_robin");
    setAssignee("");
    setCreateTask(true);
    setTaskHours(4);
    setTaskNote("");
    setSendMessage(false);
    setMessageBody("");
    setPriority(100);
    setDryRun(true);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    if (!name.trim()) return toast.error("Name required");
    if (strategy === "fixed" && !assignee) return toast.error("Pick a teammate to assign to");
    if (sendMessage && !messageBody.trim()) return toast.error("Message body required");

    const { error } = await supabase.from("routing_rules").insert({
      business_id: businessId,
      name: name.trim(),
      min_score: minScore,
      max_score: maxScore,
      stages,
      assign_strategy: strategy,
      assign_to_user_id: strategy === "fixed" ? assignee : null,
      create_task: createTask,
      task_hours: taskHours,
      task_note: taskNote.trim() || null,
      send_message: sendMessage,
      message_body: sendMessage ? messageBody.trim() : null,
      priority,
      dry_run: dryRun,
    });
    if (error) return toast.error(error.message);
    toast.success(dryRun ? "Rule created in dry-run mode" : "Rule created");
    reset();
    setOpen(false);
    load();
  };

  const patch = async (id: string, values: Partial<RoutingRule>) => {
    const { error } = await supabase.from("routing_rules").update(values).eq("id", id);
    if (error) return toast.error(error.message);
    setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...values } : r)));
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this routing rule?")) return;
    const { error } = await supabase.from("routing_rules").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  };

  const memberName = (uid: string | null) => {
    if (!uid) return "auto (least busy)";
    const m = members.find((x) => x.user_id === uid);
    return m?.display_name || m?.email || "teammate";
  };

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <RouteIcon className="h-4 w-4 text-primary" /> Lead routing
          </p>
          <p className="text-xs text-muted-foreground">
            Send hot leads to the right person automatically, with a follow-up task and optional outreach.
          </p>
        </div>
        {canWrite && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                <Plus className="mr-1 h-4 w-4" /> Routing rule
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[85vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>New routing rule</DialogTitle>
              </DialogHeader>
              <form onSubmit={add} className="space-y-4">
                <div className="space-y-1.5">
                  <Label>Rule name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Hot leads to sales" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Min score</Label>
                    <Input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Max score</Label>
                    <Input type="number" min={0} max={100} value={maxScore} onChange={(e) => setMaxScore(Number(e.target.value))} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Pipeline stages (none = all)</Label>
                  <div className="flex flex-wrap gap-2">
                    {STAGES.map((s) => (
                      <button
                        type="button"
                        key={s}
                        onClick={() => setStages((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]))}
                        className={`rounded-full border px-3 py-1 text-xs ${stages.includes(s) ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Assign to</Label>
                  <Select value={strategy} onValueChange={(v) => setStrategy(v as typeof strategy)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="round_robin">Least busy teammate</SelectItem>
                      <SelectItem value="fixed">A specific teammate</SelectItem>
                      <SelectItem value="none">Don't change assignment</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {strategy === "fixed" && (
                  <div className="space-y-1.5">
                    <Label>Teammate</Label>
                    <Select value={assignee} onValueChange={setAssignee}>
                      <SelectTrigger><SelectValue placeholder="Choose teammate" /></SelectTrigger>
                      <SelectContent>
                        {members.filter((m) => m.user_id).map((m) => (
                          <SelectItem key={m.user_id!} value={m.user_id!}>
                            {m.display_name || m.email} · {m.role}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Create follow-up task</p>
                    <p className="text-xs text-muted-foreground">Adds a reminder for the assignee.</p>
                  </div>
                  <Switch checked={createTask} onCheckedChange={setCreateTask} />
                </div>
                {createTask && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Due in (hours)</Label>
                      <Input type="number" min={1} value={taskHours} onChange={(e) => setTaskHours(Number(e.target.value))} />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Task note</Label>
                      <Input value={taskNote} onChange={(e) => setTaskNote(e.target.value)} placeholder="Call this hot lead" />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <p className="text-sm font-medium">Send outreach message</p>
                    <p className="text-xs text-muted-foreground">WhatsApp with SMS fallback. Use {"{{name}}"} for the lead's name.</p>
                  </div>
                  <Switch checked={sendMessage} onCheckedChange={setSendMessage} />
                </div>
                {sendMessage && (
                  <Textarea
                    rows={3}
                    value={messageBody}
                    onChange={(e) => setMessageBody(e.target.value)}
                    placeholder="Hi {{name}}, thanks for your interest! When can we talk?"
                  />
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Priority (lower wins)</Label>
                    <Input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} />
                  </div>
                  <div className="flex items-end justify-between rounded-md border p-3">
                    <span className="text-sm">Dry run</span>
                    <Switch checked={dryRun} onCheckedChange={setDryRun} />
                  </div>
                </div>
                <Button type="submit" className="w-full">Create rule</Button>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No routing rules yet. Create one to auto-assign leads above a score threshold.
        </p>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <div key={r.id} className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-medium">
                  {r.name}
                  {r.dry_run && (
                    <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">dry run</span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  Score {Number(r.min_score)}–{Number(r.max_score)}
                  {r.stages?.length ? ` · stages: ${r.stages.join(", ")}` : ""} · assign:{" "}
                  {r.assign_strategy === "none" ? "unchanged" : memberName(r.assign_to_user_id)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.create_task ? `Task in ${r.task_hours}h` : "No task"}
                  {r.send_message ? " · sends message" : ""} · priority {r.priority}
                </p>
              </div>
              {canWrite && (
                <div className="flex items-center gap-3">
                  <Switch checked={r.is_active} onCheckedChange={(v) => patch(r.id, { is_active: v })} />
                  <Button size="sm" variant="ghost" onClick={() => patch(r.id, { dry_run: !r.dry_run })}>
                    {r.dry_run ? "Go live" : "Dry run"}
                  </Button>
                  <button onClick={() => remove(r.id)} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
