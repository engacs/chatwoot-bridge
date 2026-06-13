import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Wifi, WifiOff, RefreshCw, Copy, Power, MessageSquare, ArrowDownLeft, ArrowUpRight,
  Clock, CheckCircle, XCircle, AlertCircle, Loader2, Plus, Settings, LogOut, Smartphone,
  Shield, Download, Trash2, Pencil, Check, X, Webhook, StopCircle, Timer, ChevronRight,
  MoreHorizontal, Zap, FlaskConical, KeyRound, Eye, EyeOff, RotateCcw
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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

function StatusDot({ status }: { status: ConnectionStatus }) {
  const colors: Record<ConnectionStatus, string> = {
    connected: "bg-emerald-500",
    connecting: "bg-amber-400 animate-pulse",
    qr_ready: "bg-amber-400 animate-pulse",
    disconnected: "bg-gray-300",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />;
}

function StatusLabel({ status }: { status: ConnectionStatus }) {
  const labels: Record<ConnectionStatus, string> = {
    connected: "Connected",
    connecting: "Connecting…",
    qr_ready: "Scan QR",
    disconnected: "Disconnected",
  };
  const colors: Record<ConnectionStatus, string> = {
    connected: "text-emerald-600",
    connecting: "text-amber-500",
    qr_ready: "text-amber-500",
    disconnected: "text-gray-400",
  };
  return (
    <span className={`text-xs font-medium ${colors[status]}`}>
      {labels[status]}
    </span>
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
      className={`w-full text-left px-3 py-2.5 rounded-lg transition-all ${
        isSelected
          ? "bg-gray-100"
          : "hover:bg-gray-50"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0 ${
          account.status === "connected"
            ? "bg-emerald-100 text-emerald-700"
            : "bg-gray-100 text-gray-500"
        }`}>
          {account.label.charAt(0).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-900 truncate">{account.label}</div>
          <div className="text-xs text-gray-400 truncate">
            {account.phoneNumber ? `+${account.phoneNumber}` : "Not connected"}
          </div>
        </div>
        <StatusDot status={account.status} />
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
      toast({ title: "Account created" });
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
        <button className="w-full flex items-center gap-2 px-3 py-2 text-sm font-medium text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors border border-dashed border-emerald-200 hover:border-emerald-300">
          <Plus className="h-4 w-4" />
          Add account
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Add WhatsApp Account</DialogTitle>
          <DialogDescription className="text-sm text-gray-500">
            Connect a new WhatsApp number to the bridge.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); createMutation.mutate(); }} className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <Label htmlFor="label" className="text-sm font-medium">Label</Label>
            <Input
              id="label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Support Line, Sales"
              required
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" size="sm" disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const QR_TIMEOUT = 15;

function QRCodeCard({ account, onRefresh }: { account: WhatsAppAccount; onRefresh: () => void }) {
  const { toast } = useToast();
  const [countdown, setCountdown] = useState(QR_TIMEOUT);
  const [expired, setExpired] = useState(false);

  const connectMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/whatsapp/accounts/${account.id}/connect`);
    },
    onSuccess: () => {
      toast({ title: "Connecting…", description: "Waiting for QR code" });
      setExpired(false);
      onRefresh();
    },
    onError: (error: Error) => {
      toast({ title: "Connection failed", description: error.message, variant: "destructive" });
    },
  });

  const stopMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/whatsapp/accounts/${account.id}/disconnect`);
    },
    onSuccess: () => {
      toast({ title: "Stopped" });
      onRefresh();
    },
    onError: (error: Error) => {
      toast({ title: "Stop failed", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (account.status !== "qr_ready") return;
    setCountdown(QR_TIMEOUT);
    setExpired(false);
    const interval = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) { clearInterval(interval); setExpired(true); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [account.qrCode, account.status]);

  if (account.status === "connected") return null;

  const radius = 18;
  const circumference = 2 * Math.PI * radius;
  const progress = expired ? 0 : (countdown / QR_TIMEOUT) * circumference;

  return (
    <div className="flex flex-col items-center py-12 gap-8">
      {account.status === "qr_ready" && account.qrCode ? (
        <>
          <div className="text-center space-y-1">
            <h3 className="font-semibold text-gray-900">Scan QR Code</h3>
            <p className="text-sm text-gray-500">Open WhatsApp → Settings → Linked Devices → Link a Device</p>
          </div>
          <div className="relative">
            <div className={`p-3 bg-white border border-gray-100 rounded-2xl shadow-sm transition-opacity ${expired ? "opacity-25" : ""}`}>
              <img src={account.qrCode} alt="WhatsApp QR Code" className="w-56 h-56" />
            </div>
            {expired ? (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-medium text-red-500 bg-white px-3 py-1 rounded-full border border-red-100">Expired</span>
              </div>
            ) : (
              <div className="absolute -top-3 -right-3 bg-white rounded-full shadow-sm border border-gray-100 p-0.5">
                <svg width="44" height="44" viewBox="0 0 44 44">
                  <circle cx="22" cy="22" r={radius} fill="none" stroke="#f3f4f6" strokeWidth="3" />
                  <circle
                    cx="22" cy="22" r={radius}
                    fill="none"
                    stroke={countdown <= 5 ? "#ef4444" : "#10b981"}
                    strokeWidth="3"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference - progress}
                    strokeLinecap="round"
                    transform="rotate(-90 22 22)"
                    style={{ transition: "stroke-dashoffset 1s linear, stroke 0.3s" }}
                  />
                  <text x="22" y="26" textAnchor="middle" fontSize="11" fontWeight="600" fill="#374151">
                    {countdown}
                  </text>
                </svg>
              </div>
            )}
          </div>
          {expired ? (
            <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending} variant="outline" size="sm">
              {connectMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              Get new QR code
            </Button>
          ) : (
            <p className="text-xs text-gray-400">Expires in {countdown}s</p>
          )}
        </>
      ) : account.status === "connecting" ? (
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">Connecting to WhatsApp…</p>
            <p className="text-xs text-gray-400 mt-0.5">This may take a few seconds</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => stopMutation.mutate()} disabled={stopMutation.isPending} className="text-gray-500">
            {stopMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <StopCircle className="h-3.5 w-3.5 mr-1.5" />}
            Stop
          </Button>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center">
            <Smartphone className="h-7 w-7 text-gray-300" />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium text-gray-700">No device connected</p>
            <p className="text-xs text-gray-400 mt-0.5">Scan a QR code to link your WhatsApp</p>
          </div>
          <Button onClick={() => connectMutation.mutate()} disabled={connectMutation.isPending} size="sm">
            {connectMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
            Connect WhatsApp
          </Button>
        </div>
      )}
    </div>
  );
}

function SessionInfoCard({ account, onRefresh }: { account: WhatsAppAccount; onRefresh: () => void }) {
  const { toast } = useToast();

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/whatsapp/accounts/${account.id}/disconnect`);
    },
    onSuccess: () => {
      toast({ title: "Disconnected" });
      onRefresh();
    },
    onError: (error: Error) => {
      toast({ title: "Disconnect failed", description: error.message, variant: "destructive" });
    },
  });

  if (account.status !== "connected") return null;

  return (
    <Card className="border-gray-100 shadow-none">
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-gray-700">Session</CardTitle>
          <div className="flex items-center gap-1.5">
            <StatusDot status="connected" />
            <StatusLabel status="connected" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Phone</span>
            <span className="text-sm font-mono font-medium text-gray-900">
              {account.phoneNumber ? `+${account.phoneNumber}` : "—"}
            </span>
          </div>
          <Separator className="bg-gray-50" />
          <Button
            variant="outline"
            size="sm"
            onClick={() => disconnectMutation.mutate()}
            disabled={disconnectMutation.isPending}
            className="w-full text-red-500 border-red-100 hover:bg-red-50 hover:text-red-600"
          >
            {disconnectMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              : <Power className="h-3.5 w-3.5 mr-1.5" />}
            Disconnect
          </Button>
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
      const payload: Record<string, string | undefined> = {
        baseUrl, inboxId, accountId: chatwootAccountId,
        webhookSecret: webhookSecret || undefined,
      };
      if (apiToken) payload.apiToken = apiToken;
      await apiRequest("POST", `/api/whatsapp/accounts/${accountId}/chatwoot`, payload);
    },
    onSuccess: () => {
      toast({ title: "Saved" });
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

  return (
    <Card className="border-gray-100 shadow-none">
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-gray-700">Chatwoot Integration</CardTitle>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            config?.configured
              ? "bg-emerald-50 text-emerald-600"
              : "bg-gray-50 text-gray-400"
          }`}>
            {config?.configured ? "Configured" : "Not set"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        {showForm ? (
          <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Chatwoot URL</Label>
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://app.chatwoot.com" required className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">API Token</Label>
              <Input type="password" value={apiToken} onChange={(e) => setApiToken(e.target.value)}
                placeholder={config?.configured ? "Leave blank to keep existing" : "Your Chatwoot API token"}
                required={!config?.configured} className="h-9 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-gray-600">Account ID</Label>
                <Input value={chatwootAccountId} onChange={(e) => setChatwootAccountId(e.target.value)} placeholder="1" required className="h-9 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-gray-600">Inbox ID</Label>
                <Input value={inboxId} onChange={(e) => setInboxId(e.target.value)} placeholder="1" required className="h-9 text-sm" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Webhook Secret <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} placeholder="HMAC signing secret" className="h-9 text-sm" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <>
            {config?.configured && (
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">URL</span>
                  <span className="font-mono text-xs text-gray-700 truncate max-w-[180px]">{config.baseUrl}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Inbox ID</span>
                  <span className="font-mono text-xs text-gray-700">{config.inboxId}</span>
                </div>
              </div>
            )}
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)} className="text-gray-600">
              <Settings className="h-3.5 w-3.5 mr-1.5" />
              {config?.configured ? "Update" : "Configure"}
            </Button>
          </>
        )}

        <div className="pt-3 border-t border-gray-50">
          <p className="text-xs text-gray-400 mb-1.5">Webhook URL</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-gray-50 text-gray-600 px-2.5 py-1.5 rounded-lg font-mono break-all border border-gray-100">
              {webhookUrl}
            </code>
            <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0"
              onClick={() => { navigator.clipboard.writeText(webhookUrl); toast({ title: "Copied!" }); }}>
              <Copy className="h-3.5 w-3.5 text-gray-400" />
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
    pending: <Clock className="h-3 w-3 text-amber-400" />,
    sent: <CheckCircle className="h-3 w-3 text-blue-400" />,
    delivered: <CheckCircle className="h-3 w-3 text-emerald-400" />,
    failed: <XCircle className="h-3 w-3 text-red-400" />,
  }[log.status] || null;

  return (
    <div className="flex items-start gap-3 py-2.5 px-1">
      <div className={`mt-0.5 w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
        isIncoming ? "bg-emerald-50" : "bg-blue-50"
      }`}>
        {isIncoming
          ? <ArrowDownLeft className="h-3 w-3 text-emerald-500" />
          : <ArrowUpRight className="h-3 w-3 text-blue-500" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-xs font-medium text-gray-700 truncate">
            {log.remoteName || log.remoteJid.replace("@s.whatsapp.net", "")}
          </span>
          {statusIcon}
        </div>
        <p className="text-xs text-gray-400 truncate">{log.content}</p>
      </div>
      <div className="text-right flex-shrink-0 mt-0.5">
        <div className="text-xs text-gray-300">
          {new Date(log.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}
        </div>
        <div className="text-xs text-gray-300">
          {new Date(log.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </div>
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
    <Card className="border-gray-100 shadow-none">
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-gray-700">Recent Messages</CardTitle>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs text-gray-400 hover:text-gray-600"
              onClick={() => window.open(`/api/whatsapp/accounts/${accountId}/logs/export?format=csv`, "_blank")}>
              <Download className="h-3 w-3 mr-1" />CSV
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs text-gray-400 hover:text-gray-600"
              onClick={() => window.open(`/api/whatsapp/accounts/${accountId}/logs/export?format=json`, "_blank")}>
              <Download className="h-3 w-3 mr-1" />JSON
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5">
        <ScrollArea className="h-[260px]">
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="h-5 w-5 animate-spin text-gray-200" />
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center py-8">
              <MessageSquare className="h-7 w-7 text-gray-200 mb-2" />
              <p className="text-sm text-gray-300">No messages yet</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
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

interface LogSettings {
  logEnabled: boolean;
  retentionMinutes: number;
  syncAvatar: boolean;
}

function LogSettingsCard({ accountId }: { accountId: number }) {
  const { toast } = useToast();

  const { data: settings, isLoading } = useQuery<LogSettings>({
    queryKey: [`/api/whatsapp/accounts/${accountId}/log-settings`],
  });

  const saveMutation = useMutation({
    mutationFn: async (update: Partial<LogSettings>) => {
      await apiRequest("POST", `/api/whatsapp/accounts/${accountId}/log-settings`, update);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/whatsapp/accounts/${accountId}/log-settings`] });
      toast({ title: "Saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  const retentionOptions = [
    { value: "0", label: "Never" },
    { value: "30", label: "30 minutes" },
    { value: "60", label: "1 hour" },
    { value: "360", label: "6 hours" },
    { value: "1440", label: "24 hours" },
    { value: "10080", label: "7 days" },
  ];

  if (isLoading) return null;

  const logEnabled = settings?.logEnabled ?? true;
  const retentionMinutes = settings?.retentionMinutes ?? 0;
  const syncAvatar = settings?.syncAvatar ?? true;

  return (
    <Card className="border-gray-100 shadow-none">
      <CardHeader className="pb-3 pt-5 px-5">
        <CardTitle className="text-sm font-semibold text-gray-700">Log Settings</CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700">Enable logging</p>
            <p className="text-xs text-gray-400">Save incoming &amp; outgoing messages</p>
          </div>
          <Switch
            checked={logEnabled}
            onCheckedChange={(checked) => saveMutation.mutate({ logEnabled: checked })}
            disabled={saveMutation.isPending}
          />
        </div>
        <Separator className="bg-gray-50" />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-700">Sync profile picture</p>
            <p className="text-xs text-gray-400">Fetch contact avatar on each message</p>
          </div>
          <Switch
            checked={syncAvatar}
            onCheckedChange={(checked) => saveMutation.mutate({ syncAvatar: checked })}
            disabled={saveMutation.isPending}
          />
        </div>
        <Separator className="bg-gray-50" />
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-gray-600">Auto-clear after</Label>
          <Select
            value={String(retentionMinutes)}
            onValueChange={(val) => saveMutation.mutate({ retentionMinutes: parseInt(val) })}
            disabled={saveMutation.isPending}
          >
            <SelectTrigger className="h-9 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {retentionOptions.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-sm">{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}

function WhatsappWebhookCard({ accountId }: { accountId: number }) {
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");

  const { data: config, refetch } = useQuery<{ webhookUrl: string; hasSecret: boolean }>({
    queryKey: [`/api/whatsapp/accounts/${accountId}/whatsapp-webhook`],
  });

  useEffect(() => {
    if (config) setWebhookUrl(config.webhookUrl || "");
  }, [config]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, string> = { webhookUrl };
      if (webhookSecret) payload.webhookSecret = webhookSecret;
      await apiRequest("POST", `/api/whatsapp/accounts/${accountId}/whatsapp-webhook`, payload);
    },
    onSuccess: () => {
      toast({ title: "Saved" });
      setWebhookSecret("");
      setShowForm(false);
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    },
  });

  const events = [
    { name: "messages.upsert", desc: "New / updated messages" },
    { name: "messages.update", desc: "Read receipts & delivery" },
    { name: "messages.delete", desc: "Deleted messages" },
    { name: "messages.reaction", desc: "Emoji reactions" },
    { name: "blocklist.update", desc: "Block / unblock events" },
  ];

  return (
    <Card className="border-gray-100 shadow-none">
      <CardHeader className="pb-3 pt-5 px-5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-gray-700">Outgoing Webhook</CardTitle>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
            config?.webhookUrl ? "bg-emerald-50 text-emerald-600" : "bg-gray-50 text-gray-400"
          }`}>
            {config?.webhookUrl ? "Active" : "Not set"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="px-5 pb-5 space-y-4">
        {showForm ? (
          <form onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(); }} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Webhook URL</Label>
              <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-server/webhook" className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">Secret <span className="text-gray-400 font-normal">(optional)</span></Label>
              <Input type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)}
                placeholder={config?.hasSecret ? "Leave blank to keep existing" : "HMAC-SHA256 signing secret"}
                className="h-9 text-sm" />
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                {saveMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
                Save
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            {config?.webhookUrl && (
              <code className="block text-xs bg-gray-50 text-gray-600 px-2.5 py-2 rounded-lg font-mono break-all border border-gray-100">
                {config.webhookUrl}
              </code>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-gray-500">Events forwarded</p>
              <div className="space-y-1">
                {events.map(e => (
                  <div key={e.name} className="flex items-center gap-2 text-xs text-gray-400">
                    <code className="bg-gray-50 text-gray-600 px-1.5 py-0.5 rounded font-mono border border-gray-100">{e.name}</code>
                    <span>{e.desc}</span>
                  </div>
                ))}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setShowForm(true)} className="text-gray-600">
              <Webhook className="h-3.5 w-3.5 mr-1.5" />
              {config?.webhookUrl ? "Update" : "Configure"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AccountDetails({ account, onRefresh }: { account: WhatsAppAccount; onRefresh: () => void }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editLabel, setEditLabel] = useState(account.label);

  useEffect(() => {
    setEditLabel(account.label);
  }, [account.label]);

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/whatsapp/accounts/${account.id}`);
    },
    onSuccess: () => {
      toast({ title: "Account deleted" });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/accounts"] });
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
    },
  });

  const updateLabelMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/whatsapp/accounts/${account.id}`, { label: editLabel });
    },
    onSuccess: () => {
      toast({ title: "Updated" });
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/accounts"] });
      setIsEditingLabel(false);
    },
    onError: (error: Error) => {
      toast({ title: "Update failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="max-w-3xl mx-auto space-y-6 py-2">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          {isEditingLabel ? (
            <div className="flex items-center gap-2">
              <Input
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                className="text-xl font-semibold h-9 w-56"
                autoFocus
              />
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => updateLabelMutation.mutate()} disabled={updateLabelMutation.isPending}>
                <Check className="h-4 w-4 text-emerald-500" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setEditLabel(account.label); setIsEditingLabel(false); }}>
                <X className="h-4 w-4 text-gray-400" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h2 className="text-xl font-semibold text-gray-900">{account.label}</h2>
              <button onClick={() => setIsEditingLabel(true)} className="text-gray-300 hover:text-gray-500 transition-colors">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <StatusDot status={account.status} />
            <StatusLabel status={account.status} />
            {account.phoneNumber && (
              <span className="text-xs text-gray-400">· +{account.phoneNumber}</span>
            )}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-gray-400">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuItem
              className="text-red-500 focus:text-red-500 cursor-pointer text-sm"
              onClick={() => {
                if (confirm(`Delete "${account.label}"? This cannot be undone.`)) {
                  deleteMutation.mutate();
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* QR / Connect */}
      {account.status !== "connected" && (
        <Card className="border-gray-100 shadow-none">
          <CardContent className="p-0">
            <QRCodeCard account={account} onRefresh={onRefresh} />
          </CardContent>
        </Card>
      )}

      {/* Connected cards */}
      {account.status === "connected" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <SessionInfoCard account={account} onRefresh={onRefresh} />
          <ChatwootConfigCard accountId={account.id} />
        </div>
      )}

      {account.status === "connected" && (
        <div className="grid gap-4 sm:grid-cols-2">
          <MessageLogsCard accountId={account.id} />
          <LogSettingsCard accountId={account.id} />
        </div>
      )}

      {account.status === "connected" && (
        <WhatsappWebhookCard accountId={account.id} />
      )}
    </div>
  );
}

function UserSettingsDialog({ user }: { user: User }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);

  const { data: tokenInfo, refetch: refetchToken } = useQuery<{ hasToken: boolean; prefix: string | null }>({
    queryKey: ["/api/auth/token"],
    enabled: open,
  });

  const generateTokenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/token");
      return res.json();
    },
    onSuccess: (data) => {
      setGeneratedToken(data.token);
      setShowToken(true);
      refetchToken();
      toast({ title: "Token generated", description: "Copy it now — it won't be shown again" });
    },
    onError: () => toast({ title: "Failed to generate token", variant: "destructive" }),
  });

  const revokeTokenMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/auth/token");
    },
    onSuccess: () => {
      setGeneratedToken(null);
      refetchToken();
      toast({ title: "Token revoked" });
    },
    onError: () => toast({ title: "Failed to revoke token", variant: "destructive" }),
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/change-password", { currentPassword, newPassword });
    },
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      toast({ title: "Password changed" });
    },
    onError: (error: Error) => toast({ title: "Failed", description: error.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setGeneratedToken(null); setShowToken(false); } }}>
      <DialogTrigger asChild>
        <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors">
          <Settings className="h-3.5 w-3.5" />
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">Account Settings</DialogTitle>
          <DialogDescription className="text-sm text-gray-500">{user.username} · {user.email}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5 pt-2">
          {/* API Token */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-gray-400" />
              <p className="text-sm font-semibold text-gray-700">API Token</p>
            </div>
            <p className="text-xs text-gray-400">Use this token to authenticate API requests with <code className="bg-gray-50 px-1 rounded">Authorization: Bearer &lt;token&gt;</code></p>

            {generatedToken ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <code className={`flex-1 text-xs bg-gray-50 border border-gray-100 px-2.5 py-2 rounded-lg font-mono break-all ${showToken ? "text-gray-700" : "blur-sm select-none"}`}>
                    {generatedToken}
                  </code>
                  <button onClick={() => setShowToken(v => !v)} className="p-1.5 text-gray-400 hover:text-gray-600">
                    {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                  <button onClick={() => { navigator.clipboard.writeText(generatedToken); toast({ title: "Copied!" }); }}
                    className="p-1.5 text-gray-400 hover:text-gray-600">
                    <Copy className="h-4 w-4" />
                  </button>
                </div>
                <p className="text-xs text-amber-500">Save this token now — it won't be shown again.</p>
              </div>
            ) : tokenInfo?.hasToken ? (
              <div className="flex items-center gap-2 p-2.5 bg-gray-50 rounded-lg border border-gray-100">
                <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                <span className="text-xs text-gray-600 flex-1">Token active — prefix <code className="font-mono">{tokenInfo.prefix}…</code></span>
              </div>
            ) : (
              <p className="text-xs text-gray-400">No token generated yet.</p>
            )}

            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => generateTokenMutation.mutate()} disabled={generateTokenMutation.isPending}>
                {generateTokenMutation.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5 mr-1.5" />}
                {tokenInfo?.hasToken ? "Regenerate" : "Generate Token"}
              </Button>
              {tokenInfo?.hasToken && (
                <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-600"
                  onClick={() => revokeTokenMutation.mutate()} disabled={revokeTokenMutation.isPending}>
                  Revoke
                </Button>
              )}
            </div>
          </div>

          <Separator className="bg-gray-50" />

          {/* Change Password */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-gray-700">Change Password</p>
            <div className="space-y-2">
              <Input
                type="password"
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="h-9 text-sm"
                autoComplete="current-password"
              />
              <div className="relative">
                <Input
                  type={showNewPassword ? "text" : "password"}
                  placeholder="New password (min 8 chars)"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="h-9 text-sm pr-9"
                  autoComplete="new-password"
                />
                <button onClick={() => setShowNewPassword(v => !v)}
                  className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600">
                  {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button size="sm" onClick={() => changePasswordMutation.mutate()}
              disabled={changePasswordMutation.isPending || !currentPassword || newPassword.length < 8}>
              {changePasswordMutation.isPending && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Update Password
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Dashboard() {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const params = useParams<{ id: string }>();
  const selectedAccountId = params.id ? parseInt(params.id) : null;

  const { data: user } = useQuery<User>({ queryKey: ["/api/auth/me"] });

  const { data: accounts = [], isLoading: accountsLoading, refetch: refetchAccounts } = useQuery<WhatsAppAccount[]>({
    queryKey: ["/api/whatsapp/accounts"],
  });

  useEffect(() => {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "status" || msg.type === "qr") {
        queryClient.setQueryData<WhatsAppAccount[]>(["/api/whatsapp/accounts"], (prev) =>
          prev?.map(a =>
            a.id === msg.accountId
              ? { ...a, ...(msg.status && { status: msg.status }), ...(msg.qrCode && { qrCode: msg.qrCode }) }
              : a
          )
        );
      }
    };

    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 30000);

    ws.onclose = () => clearInterval(ping);
    return () => { clearInterval(ping); ws.close(); };
  }, []);

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
    <div className="min-h-screen bg-white flex">
      {/* Sidebar */}
      <aside className="w-64 border-r border-gray-100 flex flex-col bg-gray-50/50">
        {/* Logo */}
        <div className="px-4 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-gray-900">WA Bridge</span>
          </div>
        </div>

        {/* Accounts */}
        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider px-3 mb-2">Accounts</p>
          {accountsLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-4 w-4 animate-spin text-gray-300" />
            </div>
          ) : (
            <>
              {accounts.map((account) => (
                <AccountCard
                  key={account.id}
                  account={account}
                  isSelected={account.id === selectedAccountId}
                  onClick={() => setLocation(`/account/${account.id}`)}
                />
              ))}
              <div className="pt-1">
                <AddAccountDialog onSuccess={() => refetchAccounts()} />
              </div>
            </>
          )}
        </div>

        {/* System */}
        <div className="px-3 py-2 border-t border-gray-100">
          <p className="text-xs font-medium text-gray-400 uppercase tracking-wider px-3 mb-1">System</p>
          <Link href={selectedAccountId ? `/account/${selectedAccountId}/webhooks` : "#"}>
            <button
              disabled={!selectedAccountId}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Webhook className="h-4 w-4" />
              Webhook Logs
            </button>
          </Link>
          <Link href={selectedAccountId ? `/test/${selectedAccountId}` : "#"}>
            <button
              disabled={!selectedAccountId}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FlaskConical className="h-4 w-4" />
              API Test
            </button>
          </Link>
        </div>

        {/* User */}
        <div className="px-3 py-3 border-t border-gray-100">
          <div className="flex items-center gap-2.5 px-2">
            <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center text-xs font-semibold text-gray-600 flex-shrink-0">
              {user?.username?.charAt(0)?.toUpperCase() || "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-700 truncate">{user?.username}</p>
              <p className="text-xs text-gray-400 truncate">{user?.email}</p>
            </div>
            <div className="flex items-center gap-0.5">
              {user?.isAdmin && (
                <Link href="/admin">
                  <button className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors">
                    <Shield className="h-3.5 w-3.5" />
                  </button>
                </Link>
              )}
              {user && <UserSettingsDialog user={user} />}
              <button
                onClick={() => logoutMutation.mutate()}
                className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-md transition-colors"
              >
                <LogOut className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">
        {selectedAccount ? (
          <div className="px-8 py-6">
            <AccountDetails account={selectedAccount} onRefresh={() => refetchAccounts()} />
          </div>
        ) : accounts.length === 0 && !accountsLoading ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <div className="w-16 h-16 rounded-2xl bg-gray-50 flex items-center justify-center mb-4">
              <Smartphone className="h-7 w-7 text-gray-300" />
            </div>
            <h2 className="text-base font-semibold text-gray-900 mb-1">No accounts yet</h2>
            <p className="text-sm text-gray-400 mb-6 max-w-xs">
              Add your first WhatsApp account to start bridging messages with Chatwoot.
            </p>
            <AddAccountDialog onSuccess={() => refetchAccounts()} />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full">
            <Loader2 className="h-6 w-6 animate-spin text-gray-200" />
          </div>
        )}
      </main>
    </div>
  );
}
