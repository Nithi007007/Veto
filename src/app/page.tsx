"use client";

/**
 * Veto dashboard — the single-page app.
 *
 * Layout:
 *  - Header (sticky): Veto wordmark + tagline + testnet badge
 *  - Two-column main: left = chat + wallet card, right = activity feed
 *  - Tabs: Dashboard / Rule book / Architecture
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  ArrowUp,
  Copy,
  ExternalLink,
  Loader2,
  Shield,
  ShieldCheck,
  ShieldX,
  Send,
  Wallet,
  BookOpen,
  Activity,
  Plus,
  Trash2,
  Power,
  Code2,
} from "lucide-react";

// ─── Types (mirror of DB shapes) ─────────────────────────────────────────
type Rule = {
  id: string;
  name: string;
  type:
    | "MAX_AMOUNT_PER_TX"
    | "DAILY_SPEND_CAP"
    | "ALLOWED_RECIPIENT"
    | "DENYLIST_ADDRESS";
  config: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type AgentRequest = {
  id: string;
  rawMessage: string;
  parsedIntent: string | null;
  amountSui: number | null;
  recipient: string | null;
  status: "PENDING" | "APPROVED" | "BLOCKED" | "EXECUTED" | "FAILED";
  failedRule: string | null;
  failReason: string | null;
  txDigest: string | null;
  createdAt: string;
};

type WalletInfo = {
  address: string;
  balanceSui: number;
  network: string;
};

// ─── Helpers ────────────────────────────────────────────────────────────
function truncateAddress(addr: string, chars = 8): string {
  if (!addr) return "";
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars + 2)}…${addr.slice(-chars)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function parseConfig(configStr: string): Record<string, any> {
  try {
    return JSON.parse(configStr);
  } catch {
    return {};
  }
}

function statusVariant(
  status: AgentRequest["status"]
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "EXECUTED":
      return "default"; // green-ish via custom class
    case "BLOCKED":
      return "destructive";
    case "FAILED":
      return "secondary";
    case "PENDING":
    case "APPROVED":
    default:
      return "outline";
  }
}

function StatusBadge({ status }: { status: AgentRequest["status"] }) {
  const cls =
    status === "EXECUTED"
      ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800"
      : status === "BLOCKED"
      ? "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800"
      : status === "FAILED"
      ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800"
      : "bg-muted text-muted-foreground border-border";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      {status === "EXECUTED" && <ShieldCheck className="h-3 w-3" />}
      {status === "BLOCKED" && <ShieldX className="h-3 w-3" />}
      {status === "FAILED" && <ShieldX className="h-3 w-3" />}
      {status === "PENDING" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "APPROVED" && <Shield className="h-3 w-3" />}
      {status}
    </span>
  );
}

// ─── Main component ─────────────────────────────────────────────────────
export default function VetoDashboard() {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [requests, setRequests] = useState<AgentRequest[]>([]);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [aliases, setAliases] = useState<{ name: string; address: string }[]>(
    []
  );
  const [loadingRequests, setLoadingRequests] = useState(true);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const fetchRequests = useCallback(async () => {
    try {
      const r = await fetch("/api/requests?limit=50");
      const data = await r.json();
      setRequests(data.requests || []);
    } catch {
      /* ignore */
    } finally {
      setLoadingRequests(false);
    }
  }, []);

  const fetchWallet = useCallback(async () => {
    try {
      const r = await fetch("/api/wallet");
      if (r.ok) {
        const data = await r.json();
        setWallet(data);
      }
    } catch {
      /* ignore */
    }
  }, []);

  const fetchRules = useCallback(async () => {
    try {
      const r = await fetch("/api/rules");
      const data = await r.json();
      setRules(data.rules || []);
    } catch {
      /* ignore */
    }
  }, []);

  const fetchAliases = useCallback(async () => {
    try {
      const r = await fetch("/api/aliases");
      const data = await r.json();
      setAliases(data.aliases || []);
    } catch {
      /* ignore */
    }
  }, []);

  const seedRules = useCallback(async () => {
    try {
      const r = await fetch("/api/seed", { method: "POST" });
      const data = await r.json();
      toast.success(data.message || "Seeded default rules");
      await fetchRules();
    } catch (e: any) {
      toast.error("Failed to seed: " + (e?.message || "unknown"));
    }
  }, [fetchRules]);

  useEffect(() => {
    fetchRequests();
    fetchWallet();
    fetchRules();
    fetchAliases();
    // Poll requests every 4s for "live" feel
    pollingRef.current = setInterval(fetchRequests, 4000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [fetchRequests, fetchWallet, fetchRules, fetchAliases]);

  // Auto-seed rules on first load if none exist
  useEffect(() => {
    if (rules.length === 0 && !loadingRequests) {
      // Try seeding once
      seedRules();
    }
  }, [rules.length, loadingRequests, seedRules]);

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      const r = await fetch("/api/agent/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      const data = await r.json();
      if (!r.ok) {
        toast.error(data.error || "Request failed");
      } else if (data.status === "EXECUTED") {
        toast.success("Transaction executed on Sui testnet", {
          description: `Digest: ${truncateAddress(data.txDigest, 6)}`,
        });
      } else if (data.status === "BLOCKED") {
        toast.warning(`Blocked by rule: ${data.failedRule}`, {
          description: data.failReason,
        });
      } else if (data.status === "FAILED") {
        toast.error("Request failed", { description: data.failReason });
      }
      setMessage("");
      // Refresh immediately
      await fetchRequests();
      await fetchWallet();
    } catch (e: any) {
      toast.error("Network error: " + (e?.message || "unknown"));
    } finally {
      setSending(false);
    }
  };

  const copyAddress = () => {
    if (!wallet) return;
    navigator.clipboard.writeText(wallet.address);
    toast.success("Address copied to clipboard");
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background">
                <Shield className="h-4 w-4" />
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold tracking-tight">Veto</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">
                  · deterministic policy gate for AI agents on Sui
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px]">
                <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 pulse-dot" />
                TESTNET
              </Badge>
              {wallet && (
                <Badge variant="outline" className="font-mono text-[10px]">
                  {wallet.balanceSui.toFixed(2)} SUI
                </Badge>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="dashboard" className="gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              Dashboard
            </TabsTrigger>
            <TabsTrigger value="rules" className="gap-1.5">
              <BookOpen className="h-3.5 w-3.5" />
              Rule book
              {rules.length > 0 && (
                <span className="ml-1 rounded bg-muted px-1.5 text-[10px] font-mono">
                  {rules.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="architecture" className="gap-1.5">
              <Code2 className="h-3.5 w-3.5" />
              Architecture
            </TabsTrigger>
          </TabsList>

          {/* ─── Dashboard tab ─── */}
          <TabsContent value="dashboard" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Left column: wallet + chat (spans 2 cols on desktop) */}
              <div className="lg:col-span-2 space-y-4">
                {/* Wallet card */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Wallet className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm font-semibold">
                          Agent wallet
                        </CardTitle>
                      </div>
                      {wallet && (
                        <a
                          href={`https://testnet.suivision.xyz/address/${wallet.address}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          View on explorer
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {wallet ? (
                      <>
                        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
                          <code className="text-xs font-mono text-muted-foreground truncate">
                            {truncateAddress(wallet.address, 12)}
                          </code>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2"
                            onClick={copyAddress}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-muted-foreground">
                            Balance
                          </span>
                          <span className="font-mono text-sm font-semibold tabular-nums">
                            {wallet.balanceSui.toFixed(4)} SUI
                          </span>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading wallet…
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Chat card */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Send className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm font-semibold">
                          Instruct the agent
                        </CardTitle>
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        plain English → SUI transfer
                      </span>
                    </div>
                    <CardDescription className="text-xs">
                      Try:{" "}
                      <em className="text-foreground/80">
                        send 1 sui to alice
                      </em>{" "}
                      ·{" "}
                      <em className="text-foreground/80">
                        send 0.5 sui to self
                      </em>{" "}
                      ·{" "}
                      <em className="text-foreground/80">
                        send 100 sui to treasury
                      </em>
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <div className="flex gap-2">
                      <Input
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                          }
                        }}
                        placeholder="Type a plain-English instruction…"
                        disabled={sending}
                        className="font-mono text-sm"
                      />
                      <Button
                        onClick={handleSend}
                        disabled={sending || !message.trim()}
                        size="default"
                      >
                        {sending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ArrowUp className="h-4 w-4" />
                        )}
                        <span className="ml-1.5 hidden sm:inline">Send</span>
                      </Button>
                    </div>
                    {aliases.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          Known aliases:
                        </span>
                        {aliases.map((a) => (
                          <Badge
                            key={a.name}
                            variant="secondary"
                            className="font-mono text-[10px] gap-1"
                          >
                            {a.name}
                            <span className="text-muted-foreground">
                              {truncateAddress(a.address, 4)}
                            </span>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Right column: activity feed */}
              <Card className="lg:col-span-1">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-muted-foreground" />
                      <CardTitle className="text-sm font-semibold">
                        Activity feed
                      </CardTitle>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2"
                      onClick={fetchRequests}
                    >
                      <Loader2
                        className={
                          "h-3 w-3 " +
                          (loadingRequests ? "animate-spin" : "hidden")
                        }
                      />
                      Refresh
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="max-h-[640px] overflow-y-auto scrollbar-slim space-y-2 pr-1">
                    {requests.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Activity className="h-8 w-8 text-muted-foreground/40 mb-2" />
                        <p className="text-sm text-muted-foreground">
                          No activity yet.
                        </p>
                        <p className="text-xs text-muted-foreground/70">
                          Send an instruction to the agent →
                        </p>
                      </div>
                    ) : (
                      requests.map((req) => (
                        <ActivityCard key={req.id} req={req} />
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ─── Rules tab ─── */}
          <TabsContent value="rules">
            <RulesTab
              rules={rules}
              onRefresh={fetchRules}
              aliases={aliases}
            />
          </TabsContent>

          {/* ─── Architecture tab ─── */}
          <TabsContent value="architecture">
            <ArchitectureTab />
          </TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-border bg-muted/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Shield className="h-3 w-3" />
              <span>
                <strong className="text-foreground">Veto</strong> — every
                action runs through a deterministic rule check. Plain code, not
                another model&apos;s opinion.
              </span>
            </div>
            <div className="flex items-center gap-3 font-mono">
              <span>Built for Sui Overflow 2026 · Agentic Web</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ─── Activity card (one row in the feed) ────────────────────────────────
function ActivityCard({ req }: { req: AgentRequest }) {
  return (
    <div
      className={
        "rounded-md border p-3 text-xs transition-colors " +
        (req.status === "EXECUTED"
          ? "border-emerald-300/50 bg-emerald-50/40 dark:border-emerald-800/50 dark:bg-emerald-950/10"
          : req.status === "BLOCKED"
          ? "border-red-300/50 bg-red-50/40 dark:border-red-800/50 dark:bg-red-950/10"
          : req.status === "FAILED"
          ? "border-amber-300/50 bg-amber-50/40 dark:border-amber-800/50 dark:bg-amber-950/10"
          : "border-border bg-muted/20")
      }
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <StatusBadge status={req.status} />
        <span className="font-mono text-[10px] text-muted-foreground">
          {formatTime(req.createdAt)}
        </span>
      </div>
      <div className="mb-1.5 font-mono text-[11px] text-foreground/90 line-clamp-2">
        &quot;{req.rawMessage}&quot;
      </div>
      {req.amountSui !== null && (
        <div className="mb-1.5 flex items-center gap-2 text-[11px]">
          <span className="text-muted-foreground">intent:</span>
          <span className="font-mono">
            transfer {req.amountSui} SUI →{" "}
            <code className="text-foreground/80">
              {truncateAddress(req.recipient || "", 6)}
            </code>
          </span>
        </div>
      )}
      {req.failedRule && (
        <div className="mb-1.5 text-[11px]">
          <span className="text-muted-foreground">blocked by:</span>{" "}
          <span className="font-semibold text-red-700 dark:text-red-300">
            {req.failedRule}
          </span>
          {req.failReason && (
            <div className="mt-0.5 text-[10px] text-muted-foreground italic">
              {req.failReason}
            </div>
          )}
        </div>
      )}
      {req.status === "FAILED" && !req.failedRule && req.failReason && (
        <div className="mb-1.5 text-[11px] text-amber-700 dark:text-amber-300">
          {req.failReason}
        </div>
      )}
      {req.txDigest && (
        <a
          href={`https://testnet.suivision.xyz/txblock/${req.txDigest}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700 dark:text-emerald-300 hover:underline"
        >
          tx {truncateAddress(req.txDigest, 6)}
          <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
    </div>
  );
}

// ─── Rules tab ──────────────────────────────────────────────────────────
function RulesTab({
  rules,
  onRefresh,
  aliases,
}: {
  rules: Rule[];
  onRefresh: () => void;
  aliases: { name: string; address: string }[];
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState<Rule["type"]>("MAX_AMOUNT_PER_TX");
  const [newMax, setNewMax] = useState("5");
  const [newCap, setNewCap] = useState("20");
  const [newAddresses, setNewAddresses] = useState("");
  const [saving, setSaving] = useState(false);

  const toggleEnabled = async (rule: Rule) => {
    try {
      await fetch(`/api/rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      onRefresh();
    } catch (e: any) {
      toast.error("Failed to toggle: " + (e?.message || "unknown"));
    }
  };

  const deleteRule = async (rule: Rule) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    try {
      await fetch(`/api/rules/${rule.id}`, { method: "DELETE" });
      onRefresh();
      toast.success("Rule deleted");
    } catch (e: any) {
      toast.error("Failed to delete: " + (e?.message || "unknown"));
    }
  };

  const addRule = async () => {
    if (!newName.trim()) {
      toast.error("Rule needs a name");
      return;
    }
    setSaving(true);
    try {
      let config: any = {};
      if (newType === "MAX_AMOUNT_PER_TX") {
        config = { maxAmountSui: Number(newMax) };
      } else if (newType === "DAILY_SPEND_CAP") {
        config = { capSui: Number(newCap) };
      } else {
        config = {
          addresses: newAddresses
            .split(/[\s,]+/)
            .map((s) => s.trim())
            .filter(Boolean),
        };
      }
      const r = await fetch("/api/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), type: newType, config }),
      });
      if (!r.ok) {
        const data = await r.json();
        throw new Error(data.error || "Failed to create rule");
      }
      toast.success("Rule added");
      setShowAdd(false);
      setNewName("");
      setNewAddresses("");
      onRefresh();
    } catch (e: any) {
      toast.error("Failed to add: " + (e?.message || "unknown"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Rule book</CardTitle>
            <CardDescription className="text-xs mt-1">
              The deterministic rule set every agent action must pass before it
              reaches the chain. Toggle, add, or delete rules live — changes
              take effect on the next request immediately.
            </CardDescription>
          </div>
          <Button size="sm" onClick={() => setShowAdd((s) => !s)}>
            <Plus className="h-3.5 w-3.5" />
            <span className="ml-1">Add rule</span>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {showAdd && (
          <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="sm:col-span-1">
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Name
                </label>
                <Input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="e.g. Per-transaction cap"
                  className="text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Type
                </label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value as any)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                >
                  <option value="MAX_AMOUNT_PER_TX">Max per transaction</option>
                  <option value="DAILY_SPEND_CAP">Daily spend cap</option>
                  <option value="ALLOWED_RECIPIENT">Allowed recipients</option>
                  <option value="DENYLIST_ADDRESS">Denylist addresses</option>
                </select>
              </div>
              <div>
                {(newType === "MAX_AMOUNT_PER_TX" ||
                  newType === "DAILY_SPEND_CAP") && (
                  <>
                    <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                      {newType === "MAX_AMOUNT_PER_TX"
                        ? "Max SUI"
                        : "Daily cap SUI"}
                    </label>
                    <Input
                      type="number"
                      step="0.1"
                      value={newType === "MAX_AMOUNT_PER_TX" ? newMax : newCap}
                      onChange={(e) =>
                        newType === "MAX_AMOUNT_PER_TX"
                          ? setNewMax(e.target.value)
                          : setNewCap(e.target.value)
                      }
                      className="text-sm font-mono"
                    />
                  </>
                )}
                {(newType === "ALLOWED_RECIPIENT" ||
                  newType === "DENYLIST_ADDRESS") && (
                  <div className="hidden sm:block" />
                )}
              </div>
            </div>
            {(newType === "ALLOWED_RECIPIENT" ||
              newType === "DENYLIST_ADDRESS") && (
              <div>
                <label className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Addresses (one per line, or comma-separated). Aliases:{" "}
                  {aliases.map((a) => a.name).join(", ")}
                </label>
                <Input
                  value={newAddresses}
                  onChange={(e) => setNewAddresses(e.target.value)}
                  placeholder={
                    newType === "ALLOWED_RECIPIENT"
                      ? "e.g. 0xabc..., 0xdef..., alice"
                      : "e.g. 0xbad..., 0xhacker..."
                  }
                  className="text-sm font-mono"
                />
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={addRule} disabled={saving}>
                {saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                Save rule
              </Button>
            </div>
          </div>
        )}

        <Separator />

        {rules.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            No rules yet. Add one above, or the system will seed defaults on
            first load.
          </div>
        ) : (
          <div className="space-y-2">
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                onToggle={() => toggleEnabled(rule)}
                onDelete={() => deleteRule(rule)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RuleRow({
  rule,
  onToggle,
  onDelete,
}: {
  rule: Rule;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const cfg = parseConfig(rule.config);
  let summary = "";
  if (rule.type === "MAX_AMOUNT_PER_TX") {
    summary = `Block transfers above ${cfg.maxAmountSui} SUI`;
  } else if (rule.type === "DAILY_SPEND_CAP") {
    summary = `Block when 24h total would exceed ${cfg.capSui} SUI`;
  } else if (rule.type === "ALLOWED_RECIPIENT") {
    const n = Array.isArray(cfg.addresses) ? cfg.addresses.length : 0;
    summary = `Only allow transfers to ${n} address${n === 1 ? "" : "es"}`;
  } else if (rule.type === "DENYLIST_ADDRESS") {
    const n = Array.isArray(cfg.addresses) ? cfg.addresses.length : 0;
    summary = `Block transfers to ${n} address${n === 1 ? "" : "es"}`;
  }

  return (
    <div
      className={
        "flex items-center justify-between gap-3 rounded-md border border-border p-3 " +
        (rule.enabled ? "bg-card" : "bg-muted/20 opacity-60")
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-semibold">{rule.name}</span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {rule.type.replace(/_/g, " ").toLowerCase()}
          </Badge>
        </div>
        <div className="text-xs text-muted-foreground">{summary}</div>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={onToggle}
          title={rule.enabled ? "Disable" : "Enable"}
        >
          <Power
            className={
              "h-3.5 w-3.5 " +
              (rule.enabled
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-muted-foreground")
            }
          />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600"
          onClick={onDelete}
          title="Delete"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ─── Architecture tab ───────────────────────────────────────────────────
function ArchitectureTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Architecture</CardTitle>
        <CardDescription className="text-xs mt-1">
          The whole pitch in one diagram: every action goes through a
          deterministic rule check before it ever reaches a signature.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-4 text-[11px] font-mono leading-relaxed text-foreground/90">{`┌──────────────┐   message    ┌──────────────────┐
│  Chat UI     │ ───────────▶ │ POST /api/agent  │
│  (Next.js)   │              │   /message       │
└──────────────┘              └─────────┬────────┘
                                        │
                             1. LLM intent parse
                                (z-ai-web-dev-sdk →
                                 strict JSON, zod-validated)
                                        │
                                        ▼
                             2. Policy Engine (pure TS,
                                zero model calls)
                                — loads enabled rules from DB
                                — evaluates intent against each
                                        │
                        ┌───────────────┴────────────────┐
                        ▼ fail                            ▼ pass
                status = BLOCKED                3. Sign & execute via
                (store reason,                     @mysten/sui
                 no chain call)                   SuiJsonRpcClient + app's
                                                  own Ed25519 testnet
                                                  keypair (server-side only)
                        │                                    │
                        └─────────────┬──────────────────────┘
                                      ▼
                          Persist AgentRequest row
                          (Prisma → SQLite)
                                      │
                                      ▼
                            UI polls → live feed`}</pre>
        <Separator className="my-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <h4 className="font-semibold mb-1.5 text-sm">Stack</h4>
            <ul className="space-y-0.5 text-muted-foreground">
              <li>
                <strong className="text-foreground">Framework:</strong> Next.js
                16, App Router, TypeScript
              </li>
              <li>
                <strong className="text-foreground">UI:</strong> Tailwind CSS +
                shadcn/ui
              </li>
              <li>
                <strong className="text-foreground">DB:</strong> Prisma +
                SQLite (swap to Neon Postgres for prod)
              </li>
              <li>
                <strong className="text-foreground">Chain:</strong> Sui Testnet
                via @mysten/sui v2
              </li>
              <li>
                <strong className="text-foreground">LLM:</strong>{" "}
                z-ai-web-dev-sdk (swappable)
              </li>
              <li>
                <strong className="text-foreground">Validation:</strong> zod
                everywhere
              </li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-1.5 text-sm">
              The single sentence that matters
            </h4>
            <blockquote className="border-l-2 border-foreground/30 pl-3 italic text-foreground/80">
              The policy check is plain TypeScript — no LLM call happens inside
              the policy engine. That sentence is the whole pitch.
            </blockquote>
            <p className="mt-3 text-muted-foreground">
              The LLM parses intent (upstream, untrusted, zod-validated). The
              policy engine decides (downstream, deterministic, auditable). The
              chain only ever sees actions that passed every enabled rule.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
