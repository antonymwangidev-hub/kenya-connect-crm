import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Flame, Snowflake, Sparkles, Users, MessageSquareText, Loader2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { generateInsights, segmentContacts, optimizeTemplates } from "@/lib/ai.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/app/insights")({ component: InsightsPage });

type Insights = Awaited<ReturnType<typeof generateInsights>>;
type Templates = Awaited<ReturnType<typeof optimizeTemplates>>;

function InsightsPage() {
  const { businessId } = useAuth();
  const insightsFn = useServerFn(generateInsights);
  const segmentFn = useServerFn(segmentContacts);
  const templatesFn = useServerFn(optimizeTemplates);

  const [insights, setInsights] = useState<Insights | null>(null);
  const [templates, setTemplates] = useState<Templates["templates"]>([]);
  const [segments, setSegments] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [segmenting, setSegmenting] = useState(false);

  useEffect(() => {
    if (!businessId) return;
    setLoading(true);
    Promise.all([
      insightsFn({ data: { businessId } }).catch((e) => { toast.error(e.message); return null; }),
      templatesFn({ data: { businessId } }).catch((e) => { toast.error(e.message); return { templates: [] }; }),
    ]).then(([i, t]) => {
      if (i) setInsights(i);
      setTemplates(t?.templates ?? []);
      setLoading(false);
    });
  }, [businessId]);

  const runSegments = async () => {
    if (!businessId) return;
    setSegmenting(true);
    try {
      const { summary } = await segmentFn({ data: { businessId } });
      setSegments(summary);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI failed");
    } finally {
      setSegmenting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <header>
          <h1 className="text-2xl font-semibold flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary" /> AI Insights</h1>
          <p className="text-sm text-muted-foreground">Smart signals from your conversations.</p>
        </header>

        {loading ? (
          <div className="grid place-items-center py-20 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Flame className="h-4 w-4 text-orange-500" /> Hot leads</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {insights?.hot.length === 0 && <p className="text-sm text-muted-foreground">No hot leads yet. Keep the conversations going.</p>}
                {insights?.hot.map((h) => (
                  <div key={h.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span className="font-medium">{h.name}</span>
                    <span className="text-xs text-muted-foreground">{h.reason}</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><Snowflake className="h-4 w-4 text-blue-500" /> Inactive leads</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {insights?.inactive.length === 0 && <p className="text-sm text-muted-foreground">Everyone is engaged. Nice.</p>}
                {insights?.inactive.map((h) => (
                  <div key={h.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <span className="font-medium">{h.name}</span>
                    <span className="text-xs text-muted-foreground">{h.days}d quiet</span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><MessageSquareText className="h-4 w-4 text-primary" /> Top performing templates</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {templates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Send a few messages and we'll rank what gets the most replies.</p>
                ) : (
                  templates.map((t, i) => (
                    <div key={i} className="rounded-md border p-3">
                      <p className="text-sm">{t.text}</p>
                      <div className="mt-1 flex gap-3 text-xs text-muted-foreground">
                        <span>{Math.round(t.replyRate * 100)}% reply rate</span>
                        <span>·</span>
                        <span>{t.sent} sent</span>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card className="md:col-span-2">
              <CardHeader className="pb-2 flex flex-row items-center justify-between space-y-0">
                <CardTitle className="flex items-center gap-2 text-base"><Users className="h-4 w-4 text-primary" /> Customer segments</CardTitle>
                <Button size="sm" variant="outline" onClick={runSegments} disabled={segmenting}>
                  {segmenting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Generate
                </Button>
              </CardHeader>
              <CardContent>
                {segments ? (
                  <pre className="whitespace-pre-wrap font-sans text-sm">{segments}</pre>
                ) : (
                  <p className="text-sm text-muted-foreground">Click Generate to let AI group your contacts.</p>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
