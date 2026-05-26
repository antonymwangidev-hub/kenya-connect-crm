import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { RefreshCw, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listWebhookLogs, listSmsLogs, retrySmsDelivery } from "@/lib/logs.functions";

export const Route = createFileRoute("/app/logs")({ component: LogsPage });

function fmtTime(s: string) {
  return new Date(s).toLocaleString();
}

function LogsPage() {
  const qc = useQueryClient();
  const fetchHooks = useServerFn(listWebhookLogs);
  const fetchSms = useServerFn(listSmsLogs);
  const retry = useServerFn(retrySmsDelivery);

  const hooks = useQuery({ queryKey: ["webhook-logs"], queryFn: () => fetchHooks() });
  const sms = useQuery({ queryKey: ["sms-logs"], queryFn: () => fetchSms() });

  const retryMut = useMutation({
    mutationFn: (smsLogId: string) => retry({ data: { smsLogId } }),
    onSuccess: (r) => {
      toast.success(`Resent via ${r.channel.toUpperCase()}`);
      qc.invalidateQueries({ queryKey: ["sms-logs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [openPayload, setOpenPayload] = useState<string | null>(null);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Logs &amp; Delivery</h1>
          <p className="text-sm text-muted-foreground">
            Inspect inbound webhooks and outbound message delivery. Retry anything that failed.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            hooks.refetch();
            sms.refetch();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </div>

      <Tabs defaultValue="deliveries">
        <TabsList>
          <TabsTrigger value="deliveries">Outbound deliveries</TabsTrigger>
          <TabsTrigger value="webhooks">Inbound webhooks</TabsTrigger>
        </TabsList>

        <TabsContent value="deliveries" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Message delivery receipts</CardTitle>
              <CardDescription>Last 100 outbound send attempts. Retry failed ones to re-run the WhatsApp → SMS fallback.</CardDescription>
            </CardHeader>
            <CardContent>
              {sms.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : !sms.data?.length ? (
                <p className="text-sm text-muted-foreground">No deliveries yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>To</TableHead>
                      <TableHead>Message</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sms.data.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-xs">{fmtTime(row.created_at)}</TableCell>
                        <TableCell className="font-mono text-xs">{row.phone}</TableCell>
                        <TableCell className="max-w-xs truncate text-sm">{row.message}</TableCell>
                        <TableCell>
                          {row.status === "sent" ? (
                            <Badge variant="secondary" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" /> sent
                            </Badge>
                          ) : row.status === "failed" ? (
                            <Badge variant="destructive" className="gap-1">
                              <XCircle className="h-3 w-3" /> failed
                            </Badge>
                          ) : (
                            <Badge variant="outline">{row.status}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={row.error ?? ""}>
                          {row.error ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.status === "failed" && (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={retryMut.isPending}
                              onClick={() => retryMut.mutate(row.id)}
                            >
                              <RefreshCw className="mr-1 h-3 w-3" /> Retry
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="webhooks" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Webhook events</CardTitle>
              <CardDescription>Last 100 inbound webhook deliveries (WhatsApp, Africa's Talking, M-Pesa).</CardDescription>
            </CardHeader>
            <CardContent>
              {hooks.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : !hooks.data?.length ? (
                <p className="text-sm text-muted-foreground">No webhook events yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>When</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Signature</TableHead>
                      <TableHead>Processed</TableHead>
                      <TableHead>Error</TableHead>
                      <TableHead className="text-right">Payload</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {hooks.data.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="whitespace-nowrap text-xs">{fmtTime(row.created_at)}</TableCell>
                        <TableCell className="text-xs">{row.source}</TableCell>
                        <TableCell>
                          {row.signature_ok ? (
                            <Badge variant="secondary" className="gap-1">
                              <CheckCircle2 className="h-3 w-3" /> ok
                            </Badge>
                          ) : (
                            <Badge variant="destructive" className="gap-1">
                              <AlertCircle className="h-3 w-3" /> invalid
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">{row.processed_at ? fmtTime(row.processed_at) : "—"}</TableCell>
                        <TableCell className="max-w-xs truncate text-xs text-muted-foreground" title={row.error ?? ""}>
                          {row.error ?? "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setOpenPayload(openPayload === row.id ? null : row.id)}
                          >
                            {openPayload === row.id ? "Hide" : "View"}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
              {openPayload && hooks.data && (
                <pre className="mt-4 max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
                  {JSON.stringify(hooks.data.find((r) => r.id === openPayload)?.payload, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
