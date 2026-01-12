import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Webhook, Clock, Code, ChevronRight, Trash2, ArrowDownLeft, ArrowUpRight, RefreshCw } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface WebhookLog {
  id: number;
  whatsappAccountId: number;
  direction: string;
  method: string;
  url: string;
  headers: any;
  body: any;
  statusCode: number | null;
  createdAt: string;
}

export default function WebhooksPage() {
  const params = useParams<{ id: string }>();
  const accountId = parseInt(params.id);
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null);
  const { toast } = useToast();

  const { data: logs = [], isLoading, refetch } = useQuery<WebhookLog[]>({
    queryKey: [`/api/whatsapp/accounts/${accountId}/webhooks`],
    refetchInterval: 5000,
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/whatsapp/accounts/${accountId}/webhooks`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/accounts/${accountId}/webhooks`] });
      toast({ title: "Logs cleared", description: "All webhook logs have been deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to clear logs", description: error.message, variant: "destructive" });
    },
  });

  const incomingLogs = logs.filter(l => l.direction === "incoming");
  const outgoingLogs = logs.filter(l => l.direction === "outgoing");

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href={`/account/${accountId}`}>
              <Button variant="ghost" size="icon" data-testid="button-back">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Webhook className="h-6 w-6 text-primary" />
                Webhook Debug Logs
              </h1>
              <p className="text-muted-foreground">
                Monitor incoming and outgoing requests in real-time
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => refetch()}
              data-testid="button-refresh"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
            <Button 
              variant="destructive" 
              size="sm" 
              onClick={() => {
                if (confirm("Are you sure you want to clear all webhook logs?")) {
                  clearMutation.mutate();
                }
              }}
              disabled={clearMutation.isPending || logs.length === 0}
              data-testid="button-clear-logs"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Clear All
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <ArrowDownLeft className="h-4 w-4 text-green-500" />
                <CardTitle className="text-base">Incoming</CardTitle>
              </div>
              <CardDescription>Requests from Chatwoot</CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">{incomingLogs.length} logs</Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <ArrowUpRight className="h-4 w-4 text-blue-500" />
                <CardTitle className="text-base">Outgoing</CardTitle>
              </div>
              <CardDescription>Requests to Chatwoot</CardDescription>
            </CardHeader>
            <CardContent>
              <Badge variant="outline">{outgoingLogs.length} logs</Badge>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>All Webhook Logs</CardTitle>
            <CardDescription>Click on any log to view full payload</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[500px] pr-4">
              {isLoading ? (
                <div className="flex items-center justify-center h-32">
                  <p className="text-muted-foreground">Loading logs...</p>
                </div>
              ) : logs.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-32 text-muted-foreground border-2 border-dashed rounded-lg">
                  <Webhook className="h-8 w-8 mb-2 opacity-20" />
                  <p>No webhooks received yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {logs.map((log) => (
                    <div
                      key={log.id}
                      className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors cursor-pointer group"
                      onClick={() => setSelectedLog(log)}
                      data-testid={`webhook-log-${log.id}`}
                    >
                      <div className="flex items-center gap-4">
                        {log.direction === "incoming" ? (
                          <ArrowDownLeft className="h-4 w-4 text-green-500" />
                        ) : (
                          <ArrowUpRight className="h-4 w-4 text-blue-500" />
                        )}
                        <Badge variant="outline" className="font-mono">
                          {log.method}
                        </Badge>
                        {log.statusCode && (
                          <Badge 
                            variant={log.statusCode >= 200 && log.statusCode < 300 ? "default" : "destructive"}
                            className="font-mono text-xs"
                          >
                            {log.statusCode}
                          </Badge>
                        )}
                        <div>
                          <p className="text-sm font-medium truncate max-w-xs">
                            {log.direction === "incoming" 
                              ? (log.body?.event || "webhook") 
                              : log.url.split("/").slice(-2).join("/")}
                          </p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {new Date(log.createdAt).toLocaleString()}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>

      <Dialog open={!!selectedLog} onOpenChange={(open) => !open && setSelectedLog(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              {selectedLog?.direction === "incoming" ? "Incoming" : "Outgoing"} Request Details
              {selectedLog?.statusCode && (
                <Badge 
                  variant={selectedLog.statusCode >= 200 && selectedLog.statusCode < 300 ? "default" : "destructive"}
                  className="ml-2"
                >
                  Status: {selectedLog.statusCode}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
            <div>
              <p className="text-sm font-medium mb-1">URL</p>
              <code className="text-xs bg-muted p-2 rounded block break-all">{selectedLog?.url}</code>
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium mb-1">Body</p>
              <ScrollArea className="h-[300px] p-4 bg-muted rounded-md">
                <pre className="text-xs font-mono whitespace-pre-wrap">
                  {JSON.stringify(selectedLog?.body, null, 2)}
                </pre>
              </ScrollArea>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
