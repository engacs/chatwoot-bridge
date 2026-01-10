import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { 
  Wifi, WifiOff, RefreshCw, Copy, Power, MessageSquare, ArrowDownLeft, ArrowUpRight, 
  Clock, CheckCircle, XCircle, AlertCircle, Loader2, Plus, Settings, LogOut, Smartphone, Shield
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface User {
  id: number;
  username: string;
  email: string;
  isAdmin?: boolean;
}

interface WhatsAppAccount {
  id: number;
  userId: number;
  label: string;
  phoneNumber: string | null;
  status: "disconnected" | "connecting" | "qr_ready" | "connected";
  qrCode: string | null;
  sessionPath: string;
}

interface MessageLog {
  id: number;
  direction: "incoming" | "outgoing";
  remoteJid: string;
  remoteName: string | null;
  content: string | null;
  status: string;
  createdAt: string;
}

interface ChatwootConfigResponse {
  configured: boolean;
  baseUrl?: string;
  inboxId?: string;
  accountId?: string;
  hasWebhookSecret?: boolean;
}

type ConnectionStatus = "disconnected" | "connecting" | "qr_ready" | "connected";

function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const config = {
    connected: {
      icon: Wifi,
      label: "Connected",
      className: "bg-green-600 text-white border-green-700",
    },
    connecting: {
      icon: Loader2,
      label: "Connecting...",
      className: "animate-pulse",
    },
    qr_ready: {
      icon: AlertCircle,
      label: "Scan QR Code",
      className: "bg-amber-500 text-white border-amber-600",
    },
    disconnected: {
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

function AccountCard({ 
  account, 
  isSelected, 
  onClick 
}: { 
  account: WhatsAppAccount; 
  isSelected: boolean; 
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-3 rounded-md transition-colors ${
        isSelected 
          ? "bg-sidebar-accent" 
          : "hover-elevate"
      }`}
      data-testid={`button-account-${account.id}`}
    >
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-md ${
          account.status === "connected" 
            ? "bg-green-100 dark:bg-green-900" 
            : "bg-muted"
        }`}>
          <Smartphone className={`h-4 w-4 ${
            account.status === "connected" 
              ? "text-green-600 dark:text-green-400" 
              : "text-muted-foreground"
          }`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium truncate">{account.label}</div>
          <div className="text-xs text-muted-foreground truncate">
            {account.phoneNumber ? `+${account.phoneNumber}` : "Not connected"}
          </div>
        </div>
        <ConnectionStatusBadge status={account.status} />
      </div>
    </button>
  );
}

function AddAccountDialog({ onSuccess }: { onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState("");
  const { toast } = useToast();

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/whatsapp/accounts", { label });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Account created", description: "You can now connect this WhatsApp account" });
      setLabel("");
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/accounts"] });
      onSuccess();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create account", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="w-full" data-testid="button-add-account">
          <Plus className="h-4 w-4 mr-2" />
          Add Account
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add WhatsApp Account</DialogTitle>
          <DialogDescription>
            Create a new WhatsApp account connection. You can connect multiple WhatsApp numbers.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="label">Account Label</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g., Support Line, Sales Team"
              required
              data-testid="input-account-label"
            />
          </div>
          <Button type="submit" disabled={createMutation.isPending} data-testid="button-create-account">
            {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Create Account
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function QRCodeCard({ 
  account, 
  onRefresh 
}: { 
  account: WhatsAppAccount; 
  onRefresh: () => void;
}) {
  const { toast } = useToast();

  const connectMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/whatsapp/accounts/${account.id}/connect`);
    },
    onSuccess: () => {
      toast({ title: "Connecting...", description: "Please wait for the QR code" });
      onRefresh();
    },
    onError: (error: Error) => {
      toast({ title: "Connection failed", description: error.message, variant: "destructive" });
    },
  });

  if (account.status === "connected") {
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
        {account.status === "qr_ready" && account.qrCode ? (
          <div className="p-4 bg-white rounded-lg shadow-sm" data-testid="img-qr-code">
            <img src={account.qrCode} alt="WhatsApp QR Code" className="w-64 h-64" />
          </div>
        ) : account.status === "connecting" ? (
          <div className="flex flex-col items-center gap-3 py-8" data-testid="status-connecting">
            <Loader2 className="h-12 w-12 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Connecting to WhatsApp...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-8" data-testid="status-disconnected">
            <WifiOff className="h-12 w-12 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Not connected</p>
            <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending}>
              {connectMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Connect
            </Button>
          </div>
        )}
        
        {account.status !== "disconnected" && (
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onRefresh}
            data-testid="button-refresh-connection"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Refresh
          </Button>
        )}
        
        <div className="text-xs text-muted-foreground text-center max-w-xs">
          Open WhatsApp on your phone, go to Settings &gt; Linked Devices &gt; Link a Device
        </div>
      </CardContent>
    </Card>
  );
}

function SessionInfoCard({ 
  account, 
  onRefresh 
}: { 
  account: WhatsAppAccount; 
  onRefresh: () => void;
}) {
  const { toast } = useToast();

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/whatsapp/accounts/${account.id}/disconnect`);
    },
    onSuccess: () => {
      toast({ title: "Disconnected", description: "WhatsApp session ended" });
      onRefresh();
    },
    onError: (error: Error) => {
      toast({ title: "Disconnect failed", description: error.message, variant: "destructive" });
    },
  });

  if (account.status !== "connected") {
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
          onClick={() => disconnectMutation.mutate()}
          disabled={disconnectMutation.isPending}
          data-testid="button-disconnect"
        >
          {disconnectMutation.isPending ? (
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
              {account.phoneNumber ? `+${account.phoneNumber}` : "Unknown"}
            </span>
          </div>
          <Separator />
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Status</span>
            <ConnectionStatusBadge status={account.status} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ChatwootConfigCard({ accountId }: { accountId: number }) {
  const [showForm, setShowForm] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiToken, setApiToken] = useState("");
  const [inboxId, setInboxId] = useState("");
  const [chatwootAccountId, setChatwootAccountId] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const { toast } = useToast();

  const { data: config, refetch } = useQuery<ChatwootConfigResponse>({
    queryKey: [`/api/whatsapp/accounts/${accountId}/chatwoot`],
  });

  useEffect(() => {
    if (config?.configured) {
      setBaseUrl(config.baseUrl || "");
      setInboxId(config.inboxId || "");
      setChatwootAccountId(config.accountId || "");
    }
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/whatsapp/accounts/${accountId}/chatwoot`, {
        baseUrl,
        apiToken,
        inboxId,
        accountId: chatwootAccountId,
        webhookSecret: webhookSecret || undefined,
      });
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Chatwoot configuration updated" });
      setShowForm(false);
      setApiToken("");
      setWebhookSecret("");
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/accounts/${accountId}/chatwoot`] });
    },
    onError: (error: Error) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  const webhookUrl = `${window.location.origin}/api/webhook/chatwoot/${accountId}`;

  const copyWebhookUrl = () => {
    navigator.clipboard.writeText(webhookUrl);
    toast({ title: "Copied!", description: "Webhook URL copied to clipboard" });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <div>
          <CardTitle className="text-lg flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Chatwoot Integration
          </CardTitle>
          <CardDescription>Connect to your Chatwoot instance</CardDescription>
        </div>
        <Badge variant={config?.configured ? "default" : "destructive"} data-testid="status-chatwoot">
          {config?.configured ? "Configured" : "Not Configured"}
        </Badge>
      </CardHeader>
      <CardContent>
        {showForm ? (
          <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="baseUrl">Chatwoot URL</Label>
              <Input
                id="baseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://app.chatwoot.com"
                required
                data-testid="input-chatwoot-url"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="apiToken">API Token</Label>
              <Input
                id="apiToken"
                type="password"
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Your Chatwoot API token"
                required
                data-testid="input-api-token"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="accountId">Account ID</Label>
                <Input
                  id="accountId"
                  value={chatwootAccountId}
                  onChange={(e) => setChatwootAccountId(e.target.value)}
                  placeholder="1"
                  required
                  data-testid="input-account-id"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="inboxId">Inbox ID</Label>
                <Input
                  id="inboxId"
                  value={inboxId}
                  onChange={(e) => setInboxId(e.target.value)}
                  placeholder="1"
                  required
                  data-testid="input-inbox-id"
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="webhookSecret">Webhook Secret (Optional)</Label>
              <Input
                id="webhookSecret"
                type="password"
                value={webhookSecret}
                onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder="HMAC signing secret"
                data-testid="input-webhook-secret"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" disabled={saveMutation.isPending} data-testid="button-save-chatwoot">
                {saveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Save Configuration
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            {config?.configured && (
              <div className="grid gap-3 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Base URL</span>
                  <span className="font-mono text-xs truncate max-w-[200px]">{config.baseUrl}</span>
                </div>
                <Separator />
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Inbox ID</span>
                  <span className="font-mono">{config.inboxId}</span>
                </div>
              </div>
            )}
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setShowForm(true)}
              data-testid="button-configure-chatwoot"
            >
              {config?.configured ? "Update Configuration" : "Configure Chatwoot"}
            </Button>
          </div>
        )}

        <div className="mt-4 pt-4 border-t">
          <Label className="text-sm text-muted-foreground">Webhook URL</Label>
          <div className="flex items-center gap-2 mt-1">
            <code className="flex-1 p-2 bg-muted rounded-md text-xs font-mono break-all">
              {webhookUrl}
            </code>
            <Button variant="outline" size="icon" onClick={copyWebhookUrl} data-testid="button-copy-webhook">
              <Copy className="h-4 w-4" />
            </Button>
          </div>
        </div>
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
  }[log.status] || null;

  return (
    <div className="flex items-start gap-3 p-3 hover-elevate rounded-md" data-testid={`log-message-${log.id}`}>
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
          {new Date(log.createdAt).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

function MessageLogsCard({ accountId }: { accountId: number }) {
  const { data: logs = [], isLoading } = useQuery<MessageLog[]>({
    queryKey: [`/api/whatsapp/accounts/${accountId}/logs`],
    refetchInterval: 10000,
  });

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

function AccountDetails({ account, onRefresh }: { account: WhatsAppAccount; onRefresh: () => void }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{account.label}</h2>
          <p className="text-muted-foreground">
            {account.phoneNumber ? `+${account.phoneNumber}` : "Not connected yet"}
          </p>
        </div>
        <ConnectionStatusBadge status={account.status} />
      </div>

      {account.status !== "connected" && (
        <QRCodeCard account={account} onRefresh={onRefresh} />
      )}

      {account.status === "connected" && (
        <div className="grid gap-6 md:grid-cols-2">
          <SessionInfoCard account={account} onRefresh={onRefresh} />
          <ChatwootConfigCard accountId={account.id} />
        </div>
      )}

      {account.status === "connected" && (
        <MessageLogsCard accountId={account.id} />
      )}
    </div>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const selectedAccountId = params.id ? parseInt(params.id) : null;

  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/me"],
  });

  const { data: accounts = [], isLoading: accountsLoading, refetch: refetchAccounts } = useQuery<WhatsAppAccount[]>({
    queryKey: ["/api/whatsapp/accounts"],
    refetchInterval: 3000,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.clear();
      setLocation("/auth");
    },
    onError: (error: Error) => {
      toast({ title: "Logout failed", description: error.message, variant: "destructive" });
    },
  });

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  useEffect(() => {
    if (accounts.length > 0 && !selectedAccountId) {
      setLocation(`/account/${accounts[0].id}`);
    }
  }, [accounts, selectedAccountId, setLocation]);

  return (
    <div className="min-h-screen bg-background flex">
      <aside className="w-72 border-r bg-sidebar flex flex-col">
        <div className="p-4 border-b">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-6 w-6 text-primary" />
            <h1 className="font-semibold">WA-Chatwoot Bridge</h1>
          </div>
        </div>

        <div className="flex-1 p-4 space-y-4">
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground px-2">WhatsApp Accounts</h3>
            {accountsLoading ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-1">
                {accounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    isSelected={account.id === selectedAccountId}
                    onClick={() => setLocation(`/account/${account.id}`)}
                  />
                ))}
              </div>
            )}
          </div>

          <AddAccountDialog onSuccess={() => refetchAccounts()} />
        </div>

        <div className="p-4 border-t">
          <div className="flex items-center justify-between">
            <div className="text-sm">
              <p className="font-medium">{user?.username}</p>
              <p className="text-xs text-muted-foreground">{user?.email}</p>
            </div>
            <div className="flex items-center gap-1">
              {user?.isAdmin && (
                <Link href="/admin">
                  <Button 
                    variant="ghost" 
                    size="icon"
                    data-testid="button-admin"
                  >
                    <Shield className="h-4 w-4" />
                  </Button>
                </Link>
              )}
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => logoutMutation.mutate()}
                data-testid="button-logout"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      <main className="flex-1 p-6 overflow-auto">
        {selectedAccount ? (
          <AccountDetails account={selectedAccount} onRefresh={() => refetchAccounts()} />
        ) : accounts.length === 0 && !accountsLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <Smartphone className="h-16 w-16 text-muted-foreground mb-4" />
            <h2 className="text-xl font-semibold mb-2">No WhatsApp Accounts</h2>
            <p className="text-muted-foreground mb-6 max-w-md">
              Add your first WhatsApp account to start bridging messages with Chatwoot.
            </p>
            <AddAccountDialog onSuccess={() => refetchAccounts()} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        )}
      </main>
    </div>
  );
}
