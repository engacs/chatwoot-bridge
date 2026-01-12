import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Webhook, Clock, Code, ChevronRight } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface WebhookLog {
  id: number;
  whatsappAccountId: number;
  method: string;
  url: string;
  headers: any;
  body: any;
  createdAt: string;
}

export default function WebhooksPage() {
  const params = useParams<{ id: string }>();
  const accountId = parseInt(params.id);
  const [selectedLog, setSelectedLog] = useState<WebhookLog | null>(null);

  const { data: logs = [], isLoading } = useQuery<WebhookLog[]>({
    queryKey: [`/api/whatsapp/accounts/${accountId}/webhooks`],
    refetchInterval: 5000,
  });

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href={`/account/${accountId}`}>
              <Button variant="ghost" size="icon">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Webhook className="h-6 w-6 text-primary" />
                Webhook Debug Logs
              </h1>
              <p className="text-muted-foreground">
                Monitor incoming requests from Chatwoot in real-time
              </p>
            </div>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Incoming Webhooks</CardTitle>
            <CardDescription>Last 100 requests received</CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[600px] pr-4">
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
                    >
                      <div className="flex items-center gap-4">
                        <Badge variant="outline" className="font-mono">
                          {log.method}
                        </Badge>
                        <div>
                          <p className="text-sm font-medium">
                            {log.body.event || "unknown_event"}
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
              Webhook Payload
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="flex-1 mt-4 p-4 bg-muted rounded-md">
            <pre className="text-xs font-mono">
              {JSON.stringify(selectedLog?.body, null, 2)}
            </pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
