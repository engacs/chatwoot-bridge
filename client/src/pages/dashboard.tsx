import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Wifi, WifiOff, RefreshCw, Copy, Power, MessageSquare, ArrowDownLeft, ArrowUpRight, Clock, CheckCircle, XCircle, AlertCircle, Loader2 } from "lucide-react";
import type { WhatsAppSession, MessageLog, WebhookEvent, ConnectionStatus } from "@shared/schema";
import { useEffect, useState } from "react";

function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const config = {
    connected: {
      variant: "default" as const,
      icon: Wifi,
      label: "Connected",
      className: "bg-green-600 text-white border-green-700",
    },
    connecting: {
      variant: "secondary" as const,
      icon: Loader2,
      label: "Connecting...",
      className: "animate-pulse",
    },
    qr_ready: {
      variant: "secondary" as const,
      icon: AlertCircle,
      label: "Scan QR Code",
      className: "bg-amber-500 text-white border-amber-600",
    },
    disconnected: {
      variant: "destructive" as const,
      icon: WifiOff,
      label: "Disconnected",
      className: "",
    },
  };

  const { icon: Icon, label, className } = config[status];

  return (
    <Badge className={`gap-1.5 ${className}`} data-testid="status-connection">
      <Icon className={`h-3 w-3 ${status === "connecting" ? "animate-spin" : ""}`} />
      {label}
    </Badge>
  );
}

function QRCodeCard({ qrCode, status, onRefresh }: { qrCode: string | null; status: ConnectionStatus; onRefresh: () => void }) {
  if (status === "connected") {
    return null;
  }

  return (
    <Card className="max-w-md mx-auto">
      <CardHeader className="text-center">
        <CardTitle className="text-xl">Connect WhatsApp</CardTitle>
        <CardDescription>
          Scan this QR code with your WhatsApp mobile app to connect
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        {status === "qr_ready" && qrCode ? (
          <div className="p-4 bg-white rounded-lg shadow-sm" data-testid="img-qr-code">
            <img src={qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
          </div>
        ) : status === "connecting" ? (
          <div className="flex flex-col items-center gap-3 py-8" data-testid="status-connecting">
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Connecting to WhatsApp...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-8" data-testid="status-disconnected">
            <WifiOff className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Not connected</p>
          </div>
        )}
        
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onRefresh}
            data-testid="button-refresh-connection"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        </div>
        
        <div className="text-xs text-muted-foreground text-center max-w-xs">
          Open WhatsApp on your phone, go to Settings &gt; Linked Devices &gt; Link a Device
        </div>
      </CardContent>
    </Card>
  );
}

function SessionInfoCard({ session, onDisconnect, isPending }: { session: WhatsAppSession; onDisconnect: () => void; isPending: boolean }) {
  if (session.status !== "connected") {
    return null;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-lg">Session Info</CardTitle>
          <CardDescription>WhatsApp connection details</CardDescription>
        </div>
        <Button 
          variant="destructive" 
          size="sm" 
          onClick={onDisconnect}
          disabled={isPending}
          data-testid="button-disconnect"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Power className="h-4 w-4 mr-2" />
          )}
          Disconnect
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Phone Number</span>
            <span className="font-mono" data-testid="text-phone-number">
              +{session.phoneNumber}
            </span>
          </div>
          <Separator />
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Connected Since</span>
            <span data-testid="text-connected-since">
              {session.connectedSince ? new Date(session.connectedSince).toLocaleString() : "N/A"}
            </span>
          </div>
          <Separator />
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Status</span>
            <ConnectionStatusBadge status={session.status} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function WebhookEndpointCard() {
  const { toast } = useToast();
  const webhookUrl = `${window.location.origin}/api/webhook/chatwoot`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast({
      title: "Copied!",
      description: "Webhook URL copied to clipboard",
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Webhook Endpoint</CardTitle>
        <CardDescription>Configure this URL in Chatwoot to receive agent replies</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-2">
          <code 
            className="flex-1 p-3 bg-muted rounded-md text-sm font-mono break-all"
            data-testid="text-webhook-url"
          >
            {webhookUrl}
          </code>
          <Button 
            variant="outline" 
            size="icon" 
            onClick={copyToClipboard}
            data-testid="button-copy-webhook"
          >
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Add this as an outgoing webhook in your Chatwoot inbox settings.
        </p>
      </CardContent>
    </Card>
  );
}

function MessageLogItem({ log }: { log: MessageLog }) {
  const isIncoming = log.direction === "incoming";
  const statusIcon = {
    pending: <Clock className="h-3 w-3 text-amber-500" />,
    sent: <CheckCircle className="h-3 w-3 text-blue-500" />,
    delivered: <CheckCircle className="h-3 w-3 text-green-500" />,
    failed: <XCircle className="h-3 w-3 text-red-500" />,
  }[log.status];

  return (
    <div 
      className="flex items-start gap-3 p-3 hover-elevate rounded-md"
      data-testid={`log-message-${log.id}`}
    >
      <div className={`p-1.5 rounded-md ${isIncoming ? "bg-green-100 dark:bg-green-900" : "bg-blue-100 dark:bg-blue-900"}`}>
        {isIncoming ? (
          <ArrowDownLeft className="h-4 w-4 text-green-600 dark:text-green-400" />
        ) : (
          <ArrowUpRight className="h-4 w-4 text-blue-600 dark:text-blue-400" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-medium truncate">
            {log.remoteName || log.remoteJid.replace("@s.whatsapp.net", "")}
          </span>
          {statusIcon}
        </div>
        <p className="text-sm text-muted-foreground truncate">{log.content}</p>
        <span className="text-xs text-muted-foreground">
          {new Date(log.timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

function MessageLogsCard({ logs, isLoading }: { logs: MessageLog[]; isLoading: boolean }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Recent Messages
          </CardTitle>
          <CardDescription>Latest synced messages</CardDescription>
        </div>
        <Badge variant="secondary" className="text-xs">
          {logs.length} messages
        </Badge>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[300px] pr-4">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
              <MessageSquare className="h-8 w-8 mb-2" />
              <p className="text-sm">No messages yet</p>
            </div>
          ) : (
            <div className="space-y-1">
              {logs.map((log) => (
                <MessageLogItem key={log.id} log={log} />
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

function ChatwootConfigCard() {
  const { data: config } = useQuery<{ baseUrl: string | null; inboxId: string | null; accountId: string | null; isConfigured: boolean }>({
    queryKey: ["/api/chatwoot/config"],
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg">Chatwoot Configuration</CardTitle>
        <CardDescription>Current integration settings</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 text-sm">
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Status</span>
            <Badge variant={config?.isConfigured ? "default" : "destructive"} data-testid="status-chatwoot">
              {config?.isConfigured ? "Configured" : "Not Configured"}
            </Badge>
          </div>
          {config?.baseUrl && (
            <>
              <Separator />
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Base URL</span>
                <span className="font-mono text-xs truncate max-w-[200px]" data-testid="text-chatwoot-url">
                  {config.baseUrl}
                </span>
              </div>
            </>
          )}
          {config?.inboxId && (
            <>
              <Separator />
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Inbox ID</span>
                <span className="font-mono" data-testid="text-inbox-id">{config.inboxId}</span>
              </div>
            </>
          )}
          {config?.accountId && (
            <>
              <Separator />
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Account ID</span>
                <span className="font-mono" data-testid="text-account-id">{config.accountId}</span>
              </div>
            </>
          )}
        </div>
        {!config?.isConfigured && (
          <p className="mt-4 text-xs text-muted-foreground">
            Set CHATWOOT_BASE_URL, CHATWOOT_API_TOKEN, CHATWOOT_INBOX_ID, and CHATWOOT_ACCOUNT_ID environment variables to configure.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const [pollInterval, setPollInterval] = useState(5000);

  const { data: session, isLoading: sessionLoading, refetch: refetchSession } = useQuery<WhatsAppSession>({
    queryKey: ["/api/session"],
    refetchInterval: pollInterval,
  });

  const { data: logs = [], isLoading: logsLoading } = useQuery<MessageLog[]>({
    queryKey: ["/api/logs"],
    refetchInterval: 10000,
  });

  const connectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/session/connect"),
    onSuccess: () => {
      toast({ title: "Connecting...", description: "Please wait for the QR code" });
      queryClient.invalidateQueries({ queryKey: ["/api/session"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const disconnectMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/session/disconnect"),
    onSuccess: () => {
      toast({ title: "Disconnected", description: "WhatsApp session ended" });
      queryClient.invalidateQueries({ queryKey: ["/api/session"] });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (session?.status === "connecting" || session?.status === "qr_ready") {
      setPollInterval(2000);
    } else {
      setPollInterval(5000);
    }
  }, [session?.status]);

  const handleRefresh = () => {
    if (session?.status === "disconnected") {
      connectMutation.mutate();
    } else {
      refetchSession();
    }
  };

  const currentStatus = session?.status || "disconnected";

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-primary" />
            <h1 className="text-lg font-semibold">WhatsApp-Chatwoot Bridge</h1>
          </div>
          <ConnectionStatusBadge status={currentStatus} />
        </div>
      </header>

      <main className="container py-6 px-4 md:px-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {sessionLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <QRCodeCard 
                qrCode={session?.qrCode || null} 
                status={currentStatus}
                onRefresh={handleRefresh}
              />

              {currentStatus === "connected" && (
                <div className="grid gap-6 md:grid-cols-2">
                  <SessionInfoCard 
                    session={session!} 
                    onDisconnect={() => disconnectMutation.mutate()}
                    isPending={disconnectMutation.isPending}
                  />
                  <ChatwootConfigCard />
                </div>
              )}

              <WebhookEndpointCard />

              <MessageLogsCard logs={logs} isLoading={logsLoading} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
