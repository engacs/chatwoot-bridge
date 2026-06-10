import { useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Send, Zap, Wifi, WifiOff, Loader2, CheckCircle, XCircle, Copy, RefreshCw, Play
} from "lucide-react";

interface WhatsAppAccount {
  id: number;
  label: string;
  phoneNumber: string | null;
  status: "disconnected" | "connecting" | "qr_ready" | "connected";
}

interface EndpointResult {
  status: number;
  body: string;
  loading: boolean;
}

function StatusDot({ status }: { status: WhatsAppAccount["status"] }) {
  const colors: Record<string, string> = {
    connected: "bg-emerald-500",
    connecting: "bg-amber-400 animate-pulse",
    qr_ready: "bg-amber-400 animate-pulse",
    disconnected: "bg-gray-300",
  };
  return <span className={`inline-block w-2 h-2 rounded-full ${colors[status]}`} />;
}

function ResultBox({ result }: { result: EndpointResult | null }) {
  if (!result) return null;
  const isOk = result.status < 300;
  let pretty = result.body;
  try { pretty = JSON.stringify(JSON.parse(result.body), null, 2); } catch {}
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center gap-2">
        <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded-full border ${
          isOk ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-red-50 text-red-500 border-red-100"
        }`}>{result.status}</span>
        {isOk ? <CheckCircle className="h-3.5 w-3.5 text-emerald-500" /> : <XCircle className="h-3.5 w-3.5 text-red-400" />}
      </div>
      <pre className="text-xs bg-gray-50 text-gray-600 px-3 py-2.5 rounded-lg border border-gray-100 overflow-auto max-h-40 font-mono whitespace-pre-wrap">
        {pretty}
      </pre>
    </div>
  );
}

async function callEndpoint(method: string, path: string, body?: object): Promise<EndpointResult> {
  try {
    const res = await apiRequest(method as any, path, body);
    const text = await res.text();
    return { status: res.status, body: text, loading: false };
  } catch (e: any) {
    return { status: 0, body: e.message || "Network error", loading: false };
  }
}

export default function TestPage() {
  const params = useParams<{ id: string }>();
  const accountId = parseInt(params.id);
  const { toast } = useToast();

  // Send message
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  const [sendResult, setSendResult] = useState<EndpointResult | null>(null);
  const [sendLoading, setSendLoading] = useState(false);

  // Check number
  const [checkPhone, setCheckPhone] = useState("");
  const [checkResult, setCheckResult] = useState<{ exists: boolean; profilePicture?: string } | null>(null);
  const [checkLoading, setCheckLoading] = useState(false);

  // Webhook test
  const [webhookPayload, setWebhookPayload] = useState(`{\n  "event": "test",\n  "message": "Hello from test page"\n}`);
  const [webhookResult, setWebhookResult] = useState<EndpointResult | null>(null);
  const [webhookLoading, setWebhookLoading] = useState(false);

  // Per-endpoint results for API Reference
  const [epResults, setEpResults] = useState<Record<string, EndpointResult | null>>({});
  const [epLoading, setEpLoading] = useState<Record<string, boolean>>({});

  const { data: account, isLoading } = useQuery<WhatsAppAccount>({
    queryKey: [`/api/whatsapp/accounts`],
    select: (data: any) => Array.isArray(data) ? data.find((a: WhatsAppAccount) => a.id === accountId) : undefined,
  });

  const handleSend = async () => {
    if (!phone || !message) return;
    setSendLoading(true);
    const r = await callEndpoint("POST", `/api/whatsapp/accounts/${accountId}/send`, { phoneNumber: phone, content: message });
    setSendResult(r);
    setSendLoading(false);
    if (r.status < 300) toast({ title: "Message sent" });
  };

  const handleCheck = async () => {
    if (!checkPhone) return;
    setCheckLoading(true);
    const r = await callEndpoint("GET", `/api/whatsapp/accounts/${accountId}/profile/${checkPhone}`);
    setCheckLoading(false);
    try {
      const data = JSON.parse(r.body);
      setCheckResult(data);
    } catch {
      setCheckResult(null);
      toast({ title: "Check failed", description: r.body, variant: "destructive" });
    }
  };

  const handleWebhookTest = async () => {
    setWebhookLoading(true);
    try {
      const payload = JSON.parse(webhookPayload);
      const res = await fetch(`/api/webhook/chatwoot/${accountId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.text();
      setWebhookResult({ status: res.status, body, loading: false });
    } catch (e: any) {
      toast({ title: "Test failed", description: e.message, variant: "destructive" });
    }
    setWebhookLoading(false);
  };

  // Per-endpoint editable path params and body
  const [epParams, setEpParams] = useState<Record<string, string>>({});
  const [epBody, setEpBody] = useState<Record<string, string>>({});

  const handleEpTest = async (key: string, method: string, pathTemplate: string) => {
    const resolvedPath = epParams[key] !== undefined ? epParams[key] : pathTemplate;
    let body: object | undefined;
    if (method !== "GET" && method !== "DELETE" && epBody[key]) {
      try { body = JSON.parse(epBody[key]); } catch { toast({ title: "Invalid JSON body", variant: "destructive" }); return; }
    }
    setEpLoading(prev => ({ ...prev, [key]: true }));
    const r = await callEndpoint(method, resolvedPath, body);
    setEpResults(prev => ({ ...prev, [key]: r }));
    setEpLoading(prev => ({ ...prev, [key]: false }));
  };

  const webhookUrl = `${window.location.origin}/api/webhook/chatwoot/${accountId}`;

  const ph = phone || "252618629126";
  const endpoints: { method: string; path: string; desc: string; group: string; editablePath?: boolean; defaultBody?: string }[] = [
    // Account
    { group: "Account",   method: "GET",    path: `/api/whatsapp/accounts`,                                       desc: "List all accounts" },
    { group: "Account",   method: "GET",    path: `/api/whatsapp/accounts/${accountId}`,                          desc: "Get this account" },
    { group: "Account",   method: "POST",   path: `/api/whatsapp/accounts/${accountId}/connect`,                  desc: "Connect WhatsApp" },
    { group: "Account",   method: "POST",   path: `/api/whatsapp/accounts/${accountId}/disconnect`,               desc: "Disconnect" },
    // Groups
    { group: "Groups",    method: "GET",    path: `/api/whatsapp/accounts/${accountId}/groups`,                   desc: "List all groups" },
    { group: "Groups",    method: "GET",    path: `/api/whatsapp/accounts/${accountId}/groups/GROUP_JID@g.us`,    desc: "Group metadata", editablePath: true },
    // Contacts
    { group: "Contacts",  method: "GET",    path: `/api/whatsapp/accounts/${accountId}/contact/${ph}`,            desc: "Contact info + pic", editablePath: true },
    { group: "Contacts",  method: "GET",    path: `/api/whatsapp/accounts/${accountId}/profile/${ph}`,            desc: "Profile (exists check)", editablePath: true },
    // Blocklist
    { group: "Blocklist", method: "GET",    path: `/api/whatsapp/accounts/${accountId}/blocklist`,                desc: "Get block list" },
    { group: "Blocklist", method: "POST",   path: `/api/whatsapp/accounts/${accountId}/block`,                    desc: "Block/unblock number",
      defaultBody: `{"phoneNumber":"${ph}","action":"block"}` },
    // Messaging
    { group: "Messaging", method: "POST",   path: `/api/whatsapp/accounts/${accountId}/send`,                    desc: "Send message",
      defaultBody: `{"phoneNumber":"${ph}","content":"Hello test!"}` },
    { group: "Messaging", method: "GET",    path: `/api/whatsapp/accounts/${accountId}/logs`,                    desc: "Message logs" },
    { group: "Messaging", method: "GET",    path: `/api/whatsapp/accounts/${accountId}/logs/export?format=json`, desc: "Export logs (JSON)" },
    { group: "Messaging", method: "GET",    path: `/api/whatsapp/accounts/${accountId}/logs/export?format=csv`,  desc: "Export logs (CSV)" },
    // Chatwoot
    { group: "Chatwoot",  method: "GET",    path: `/api/whatsapp/accounts/${accountId}/chatwoot`,                desc: "Chatwoot config" },
    { group: "Chatwoot",  method: "POST",   path: `/api/webhook/chatwoot/${accountId}`,                          desc: "Chatwoot webhook receiver",
      defaultBody: `{"event":"message_created","message_type":"outgoing"}` },
    // Webhooks
    { group: "Webhooks",  method: "GET",    path: `/api/whatsapp/accounts/${accountId}/whatsapp-webhook`,        desc: "Outgoing webhook config" },
    { group: "Webhooks",  method: "GET",    path: `/api/whatsapp/accounts/${accountId}/webhooks`,                desc: "Webhook debug logs" },
    { group: "Webhooks",  method: "DELETE", path: `/api/whatsapp/accounts/${accountId}/webhooks`,               desc: "Clear webhook logs" },
    // Settings
    { group: "Settings",  method: "GET",    path: `/api/whatsapp/accounts/${accountId}/log-settings`,            desc: "Log settings" },
    // Auth
    { group: "Auth",      method: "GET",    path: `/api/auth/me`,                                                 desc: "Current user" },
    { group: "Auth",      method: "GET",    path: `/api/auth/token`,                                              desc: "API token info" },
    // System
    { group: "System",    method: "GET",    path: `/api/health`,                                                  desc: "Health check" },
  ];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gray-300" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-4">
          <Link href={`/account/${accountId}`}>
            <button className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500">
              <ArrowLeft className="h-4 w-4" />
            </button>
          </Link>
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 bg-emerald-500 rounded-lg flex items-center justify-center">
              <Zap className="h-4 w-4 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-gray-900">API Test</h1>
              {account && (
                <div className="flex items-center gap-1.5">
                  <StatusDot status={account.status} />
                  <span className="text-xs text-gray-400">{account.label}</span>
                  {account.phoneNumber && <span className="text-xs text-gray-300">· +{account.phoneNumber}</span>}
                </div>
              )}
            </div>
          </div>
          {account?.status !== "connected" && (
            <span className="ml-auto text-xs text-amber-500 bg-amber-50 px-2 py-1 rounded-full border border-amber-100">
              Account not connected
            </span>
          )}
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Send Message */}
        <Card className="border-gray-100 shadow-none bg-white">
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Send className="h-4 w-4" />
              Send WhatsApp Message
            </CardTitle>
            <CardDescription className="text-xs">Send a test message from this WhatsApp account</CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-gray-600">Phone Number</Label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="252618629126" className="h-9 text-sm font-mono" />
                <p className="text-xs text-gray-400">Without + or spaces</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-gray-600">Message</Label>
                <Input value={message} onChange={(e) => setMessage(e.target.value)}
                  placeholder="Hello, test message!" className="h-9 text-sm"
                  onKeyDown={(e) => e.key === "Enter" && handleSend()} />
              </div>
            </div>
            <Button size="sm" onClick={handleSend} disabled={sendLoading || !phone || !message}>
              {sendLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
              Send
            </Button>
            <ResultBox result={sendResult} />
          </CardContent>
        </Card>

        {/* Check Number */}
        <Card className="border-gray-100 shadow-none bg-white">
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
              <Wifi className="h-4 w-4" />
              Check WhatsApp Number
            </CardTitle>
            <CardDescription className="text-xs">Check if a phone number has WhatsApp</CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-3">
            <div className="flex gap-3">
              <Input value={checkPhone} onChange={(e) => setCheckPhone(e.target.value)}
                placeholder="252618629126" className="h-9 text-sm font-mono max-w-xs"
                onKeyDown={(e) => e.key === "Enter" && handleCheck()} />
              <Button size="sm" variant="outline" onClick={handleCheck} disabled={checkLoading || !checkPhone}>
                {checkLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
                Check
              </Button>
            </div>
            {checkResult && (
              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                {checkResult.exists ? (
                  <>
                    <CheckCircle className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-emerald-700">Number is on WhatsApp</p>
                      {checkResult.profilePicture && (
                        <a href={checkResult.profilePicture} target="_blank" rel="noreferrer" className="text-xs text-blue-500 underline">
                          View profile picture
                        </a>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <WifiOff className="h-4 w-4 text-gray-400 flex-shrink-0" />
                    <p className="text-sm text-gray-500">Not on WhatsApp</p>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Webhook Test */}
        <Card className="border-gray-100 shadow-none bg-white">
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-sm font-semibold text-gray-700">Chatwoot Webhook Test</CardTitle>
            <CardDescription className="text-xs">Send a raw JSON payload to this account's webhook endpoint</CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-5 space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium text-gray-600">Endpoint</Label>
                <button className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1"
                  onClick={() => { navigator.clipboard.writeText(webhookUrl); toast({ title: "Copied!" }); }}>
                  <Copy className="h-3 w-3" />Copy URL
                </button>
              </div>
              <code className="block text-xs bg-gray-50 text-gray-600 px-2.5 py-2 rounded-lg font-mono border border-gray-100 break-all">
                POST {webhookUrl}
              </code>
            </div>
            <Separator className="bg-gray-50" />
            <div className="space-y-1.5">
              <Label className="text-xs font-medium text-gray-600">JSON Payload</Label>
              <Textarea value={webhookPayload} onChange={(e) => setWebhookPayload(e.target.value)}
                className="font-mono text-xs h-32 resize-none" spellCheck={false} />
            </div>
            <Button size="sm" variant="outline" onClick={handleWebhookTest} disabled={webhookLoading}>
              {webhookLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
              Send
            </Button>
            <ResultBox result={webhookResult} />
          </CardContent>
        </Card>

        {/* API Reference with Test buttons */}
        <Card className="border-gray-100 shadow-none bg-white">
          <CardHeader className="pb-3 pt-5 px-5">
            <CardTitle className="text-sm font-semibold text-gray-700">API Reference</CardTitle>
            <CardDescription className="text-xs">Key endpoints for account #{accountId} — click Run to test</CardDescription>
          </CardHeader>
          <CardContent className="px-5 pb-5">
            <div className="space-y-5">
              {Array.from(new Set(endpoints.map(e => e.group))).map(group => (
                <div key={group}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">{group}</p>
                  <div className="space-y-3">
                    {endpoints.filter(e => e.group === group).map((ep) => {
                      const key = `${ep.method}:${ep.path}`;
                      const result = epResults[key] ?? null;
                      const loading = epLoading[key] ?? false;
                      const methodColor = ep.method === "GET" ? "text-blue-500" : ep.method === "DELETE" ? "text-red-400" : "text-emerald-600";
                      const hasBody = ep.method !== "GET" && ep.method !== "DELETE";
                      const currentBody = epBody[key] ?? ep.defaultBody ?? "";
                      const currentPath = epParams[key] ?? ep.path;
                      return (
                        <div key={key} className="space-y-1.5 p-3 rounded-lg border border-gray-100 bg-gray-50/50">
                          <div className="flex items-center gap-2">
                            <span className={`text-xs font-mono font-bold w-12 flex-shrink-0 ${methodColor}`}>{ep.method}</span>
                            <span className="text-xs text-gray-400 flex-1 truncate">{ep.desc}</span>
                            <Button size="sm" variant="outline" className="h-7 px-2.5 flex-shrink-0 bg-white"
                              disabled={loading} onClick={() => handleEpTest(key, ep.method, ep.path)}>
                              {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                            </Button>
                            {result && (
                              <span className={`text-xs font-mono w-8 text-center px-1 py-0.5 rounded border flex-shrink-0 ${
                                result.status < 300 ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-red-50 text-red-400 border-red-100"
                              }`}>{result.status}</span>
                            )}
                          </div>
                          {/* Editable path */}
                          <input
                            className="w-full text-xs font-mono bg-white border border-gray-200 rounded-md px-2 py-1.5 text-gray-600 focus:outline-none focus:border-gray-400"
                            value={currentPath}
                            onChange={(e) => setEpParams(prev => ({ ...prev, [key]: e.target.value }))}
                          />
                          {/* Body input for POST/PATCH */}
                          {hasBody && (
                            <textarea
                              rows={3}
                              placeholder="JSON body (optional)"
                              className="w-full text-xs font-mono bg-white border border-gray-200 rounded-md px-2 py-1.5 text-gray-600 resize-none focus:outline-none focus:border-gray-400"
                              value={currentBody}
                              onChange={(e) => setEpBody(prev => ({ ...prev, [key]: e.target.value }))}
                            />
                          )}
                          {result && (
                            <pre className="text-xs bg-white text-gray-500 px-3 py-2 rounded-lg border border-gray-100 overflow-auto max-h-36 font-mono whitespace-pre-wrap">
                              {(() => { try { return JSON.stringify(JSON.parse(result.body), null, 2); } catch { return result.body; } })()}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
