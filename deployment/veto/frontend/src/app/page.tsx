"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { toast } from "sonner";
import { apiFetch, API_URL } from "@/lib/api";
import type { Rule, AgentRequest, WalletInfo, VaultState, VaultCommit, TamperState } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import {
  ArrowUp, Copy, ExternalLink, Loader2, Shield, ShieldCheck, ShieldX,
  Send, Wallet, BookOpen, Activity, Plus, Trash2, Power, Code2, Lock,
  AlertTriangle, CheckCircle2, XCircle, Fingerprint, GitCommit,
} from "lucide-react";

// ─── Helpers ───
function truncateAddress(addr: string, chars = 8): string {
  if (!addr) return "";
  if (addr.length <= chars * 2 + 2) return addr;
  return `${addr.slice(0, chars + 2)}…${addr.slice(-chars)}`;
}
function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
function parseConfig(c: unknown): Record<string, any> {
  if (c == null) return {};
  if (typeof c === "object") return c as Record<string, any>;
  if (typeof c === "string") { try { return JSON.parse(c); } catch { return {}; } }
  return {};
}
function mistToSui(mist: string): number { try { return Number(BigInt(mist)) / 1e9; } catch { return 0; } }
function shortHash(hash: string): string { return !hash ? "—" : hash.length <= 18 ? hash : `${hash.slice(0, 18)}…`; }

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === "EXECUTED" ? "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800"
    : status === "BLOCKED" ? "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800"
    : status === "FAILED" ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800"
    : status === "AWAITING_CONFIRMATION" ? "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800"
    : "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {status === "EXECUTED" && <ShieldCheck className="h-3 w-3" />}
      {status === "BLOCKED" && <ShieldX className="h-3 w-3" />}
      {status === "FAILED" && <ShieldX className="h-3 w-3" />}
      {status === "AWAITING_CONFIRMATION" && <Lock className="h-3 w-3" />}
      {status === "PENDING" && <Loader2 className="h-3 w-3 animate-spin" />}
      {status === "APPROVED" && <Shield className="h-3 w-3" />}
      {status.replace(/_/g, " ")}
    </span>
  );
}

// ─── Main Page ───
export default function Home() {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [requests, setRequests] = useState<AgentRequest[]>([]);
  const [wallet, setWallet] = useState<WalletInfo | null>(null);
  const [rules, setRules] = useState<Rule[]>([]);
  const [aliases, setAliases] = useState<{ name: string; address: string }[]>([]);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [commit, setCommit] = useState<VaultCommit | null>(null);
  const [tamper, setTamper] = useState<TamperState | null>(null);
  const [ownerAuth, setOwnerAuth] = useState(false);
  const [loadingRequests, setLoadingRequests] = useState(true);
  const [loginOpen, setLoginOpen] = useState(false);
  const [loginPw, setLoginPw] = useState("");
  const [loggingIn, setLoggingIn] = useState(false);
  const [confirmDlg, setConfirmDlg] = useState<{ open: boolean; id: string | null; raw: string; intent: any; diff: any; busy: boolean }>({
    open: false, id: null, raw: "", intent: null, diff: null, busy: false,
  });
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const fetchRequests = useCallback(async () => {
    try { const r = await apiFetch("/api/requests?limit=50"); const d = await r.json(); setRequests(d.requests || []); }
    catch {} finally { setLoadingRequests(false); }
  }, []);
  const fetchWallet = useCallback(async () => {
    try { const r = await apiFetch("/api/wallet"); if (r.ok) setWallet(await r.json()); } catch {}
  }, []);
  const fetchRules = useCallback(async () => {
    try {
      const r = await apiFetch("/api/rules"); const d = await r.json();
      setRules(d.rules || []); setVault(d.vault || null); setCommit(d.commit || null); setTamper(d.tamper || null);
    } catch {}
  }, []);
  const fetchAliases = useCallback(async () => {
    try { const r = await apiFetch("/api/aliases"); const d = await r.json(); setAliases(d.aliases || []); } catch {}
  }, []);
  const fetchOwnerStatus = useCallback(async () => {
    try { const r = await apiFetch("/api/owner/status"); if (r.ok) { const d = await r.json(); setOwnerAuth(d.authenticated); } } catch {}
  }, []);

  const seedRules = useCallback(async () => {
    try { await apiFetch("/api/seed", { method: "POST" }); await fetchRules(); } catch {}
  }, [fetchRules]);

  useEffect(() => {
    fetchRequests(); fetchWallet(); fetchRules(); fetchAliases(); fetchOwnerStatus();
    pollRef.current = setInterval(fetchRequests, 4000);
    const tamperInt = setInterval(fetchRules, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); clearInterval(tamperInt); };
  }, [fetchRequests, fetchWallet, fetchRules, fetchAliases, fetchOwnerStatus]);

  useEffect(() => { if (rules.length === 0 && !loadingRequests) seedRules(); }, [rules.length, loadingRequests, seedRules]);

  const handleSend = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      const r = await apiFetch("/api/agent/message", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      const d = await r.json();
      if (!r.ok) { toast.error(d.error || "Request failed"); }
      else if (d.status === "AWAITING_CONFIRMATION") {
        setConfirmDlg({ open: true, id: d.id, raw: d.rawMessage, intent: d.parsedIntent, diff: d.diff, busy: false });
      } else if (d.status === "FAILED") { toast.error("Could not parse", { description: d.failReason }); }
      setMessage(""); await fetchRequests();
    } catch (e: any) { toast.error("Network error: " + (e?.message || "unknown")); }
    finally { setSending(false); }
  };

  const handleConfirm = async (decision: "confirm" | "reject") => {
    if (!confirmDlg.id) return;
    setConfirmDlg(s => ({ ...s, busy: true }));
    try {
      const r = await apiFetch("/api/agent/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: confirmDlg.id, decision }),
      });
      const d = await r.json();
      if (d.status === "EXECUTED") toast.success("Transaction executed on Sui testnet", { description: `Digest: ${truncateAddress(d.txDigest, 6)}` });
      else if (d.status === "BLOCKED") {
        if (d.failedRule === "user_rejected") toast.info("Intent rejected");
        else toast.warning(`Blocked: ${d.failedRule}`, { description: d.failReason });
      } else if (d.status === "FAILED") toast.error("Execution failed", { description: d.failReason });
      setConfirmDlg({ open: false, id: null, raw: "", intent: null, diff: null, busy: false });
      await fetchRequests(); await fetchWallet(); await fetchRules();
    } catch (e: any) { toast.error("Network error: " + (e?.message || "unknown")); }
    finally { setConfirmDlg(s => ({ ...s, busy: false })); }
  };

  const handleLogin = async () => {
    if (!loginPw) return;
    setLoggingIn(true);
    try {
      const r = await apiFetch("/api/owner/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: loginPw }),
      });
      const d = await r.json();
      if (r.ok) { toast.success("Owner session established"); setLoginOpen(false); setLoginPw(""); await fetchOwnerStatus(); await fetchRules(); }
      else toast.error(d.error || "Login failed");
    } catch (e: any) { toast.error("Network error: " + (e?.message || "unknown")); }
    finally { setLoggingIn(false); }
  };

  const handleLogout = async () => {
    try { await apiFetch("/api/owner/logout", { method: "POST" }); toast.info("Logged out"); await fetchOwnerStatus(); } catch {}
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-14 items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-md bg-foreground text-background"><Shield className="h-4 w-4" /></div>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-bold tracking-tight">Veto</span>
                <span className="hidden text-xs text-muted-foreground sm:inline">· deterministic, verifiable policy gate for AI agents on Sui</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="font-mono text-[10px]"><span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-amber-500 pulse-dot" />TESTNET</Badge>
              {wallet && <Badge variant="outline" className="font-mono text-[10px]">{wallet.balanceSui.toFixed(2)} SUI</Badge>}
              {commit && <Badge variant="outline" className="font-mono text-[10px] gap-1"><GitCommit className="h-3 w-3" />v{commit.version}</Badge>}
              {ownerAuth ? (
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[10px]" onClick={handleLogout}><Lock className="h-3 w-3 text-emerald-600" />OWNER</Button>
              ) : (
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-[10px]" onClick={() => setLoginOpen(true)}><Lock className="h-3 w-3" />LOGIN</Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Tamper banner */}
      {tamper?.tampered && (
        <div className="bg-red-600 text-white border-b border-red-800">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-3 flex items-start gap-3 text-sm">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <strong className="font-bold">RULE BOOK TAMPERING DETECTED.</strong>{" "}
              <span className="text-red-100">The current rule set does not match the last committed hash. Someone edited rules directly in the DB.</span>
              <div className="mt-1.5 font-mono text-[10px] text-red-100">
                <div>committed: {tamper.committedHash}</div>
                <div>current:&nbsp;&nbsp; {tamper.currentHash}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <main className="flex-1 mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8 py-6">
        <Tabs defaultValue="dashboard" className="w-full">
          <TabsList className="mb-4">
            <TabsTrigger value="dashboard" className="gap-1.5"><Activity className="h-3.5 w-3.5" />Dashboard</TabsTrigger>
            <TabsTrigger value="rules" className="gap-1.5"><BookOpen className="h-3.5 w-3.5" />Rule book {rules.length > 0 && <span className="ml-1 rounded bg-muted px-1.5 text-[10px] font-mono">{rules.length}</span>}</TabsTrigger>
            <TabsTrigger value="architecture" className="gap-1.5"><Code2 className="h-3.5 w-3.5" />Architecture</TabsTrigger>
          </TabsList>

          {/* Dashboard tab */}
          <TabsContent value="dashboard" className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-2 space-y-4">
                {/* Wallet card */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><Wallet className="h-4 w-4 text-muted-foreground" /><CardTitle className="text-sm font-semibold">Agent wallet</CardTitle></div>
                      {wallet && <a href={`https://testnet.suivision.xyz/address/${wallet.address}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Explorer <ExternalLink className="h-3 w-3" /></a>}
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {wallet ? (
                      <>
                        <div className="flex items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-2">
                          <code className="text-xs font-mono text-muted-foreground truncate">{truncateAddress(wallet.address, 12)}</code>
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => { navigator.clipboard.writeText(wallet.address); toast.success("Copied"); }}><Copy className="h-3 w-3" /></Button>
                        </div>
                        <div className="flex items-center justify-between"><span className="text-xs text-muted-foreground">Balance</span><span className="font-mono text-sm font-semibold tabular-nums">{wallet.balanceSui.toFixed(4)} SUI</span></div>
                      </>
                    ) : <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading wallet…</div>}
                  </CardContent>
                </Card>

                {/* Vault card */}
                {vault && (
                  <Card className="border-foreground/20">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2"><Lock className="h-4 w-4 text-foreground" /><CardTitle className="text-sm font-semibold">On-chain vault</CardTitle></div>
                        <Badge variant="outline" className="font-mono text-[10px] gap-1"><AlertTriangle className="h-2.5 w-2.5 text-amber-500" />SIMULATED</Badge>
                      </div>
                      <CardDescription className="text-xs mt-1">Hard caps enforced at the chain level. Survives backend compromise.</CardDescription>
                    </CardHeader>
                    <CardContent className="pt-0 space-y-2 text-xs">
                      <div className="grid grid-cols-3 gap-2">
                        <div className="rounded-md border border-border bg-muted/30 p-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Per-tx cap</div><div className="font-mono font-semibold">{mistToSui(vault.config.perTxCapMist).toFixed(2)} SUI</div></div>
                        <div className="rounded-md border border-border bg-muted/30 p-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Daily cap</div><div className="font-mono font-semibold">{mistToSui(vault.config.dailyCapMist).toFixed(2)} SUI</div></div>
                        <div className="rounded-md border border-border bg-muted/30 p-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spent today</div><div className="font-mono font-semibold">{mistToSui(vault.spentTodayMist).toFixed(4)} SUI</div></div>
                      </div>
                      {commit && (
                        <div className="rounded-md border border-border bg-muted/20 p-2 flex items-center justify-between">
                          <div className="min-w-0"><div className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1"><Fingerprint className="h-2.5 w-2.5" />Rule book commit · v{commit.version}</div><code className="text-[11px] font-mono text-foreground/80">{shortHash(commit.commitHash)}</code></div>
                          <span className="text-[10px] text-muted-foreground font-mono">{new Date(commit.createdAt).toLocaleString()}</span>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* Chat card */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2"><Send className="h-4 w-4 text-muted-foreground" /><CardTitle className="text-sm font-semibold">Instruct the agent</CardTitle></div>
                      <span className="text-[10px] font-mono text-muted-foreground">plain English → SUI transfer</span>
                    </div>
                    <CardDescription className="text-xs">Try: <em className="text-foreground/80">send 1 sui to alice</em> · <em className="text-foreground/80">send 100 sui to treasury</em></CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    <div className="flex gap-2">
                      <Input value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }} placeholder="Type a plain-English instruction…" disabled={sending} className="font-mono text-sm" />
                      <Button onClick={handleSend} disabled={sending || !message.trim()}>{sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}<span className="ml-1.5 hidden sm:inline">Send</span></Button>
                    </div>
                    {aliases.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Aliases:</span>
                        {aliases.map(a => <Badge key={a.name} variant="secondary" className="font-mono text-[10px] gap-1">{a.name}<span className="text-muted-foreground">{truncateAddress(a.address, 4)}</span></Badge>)}
                      </div>
                    )}
                    <div className="rounded-md border border-dashed border-border bg-muted/20 p-2 text-[10px] text-muted-foreground flex items-start gap-2">
                      <Lock className="h-3 w-3 mt-0.5 flex-shrink-0" />
                      <span>Two-step flow: LLM parses → you confirm → policy engine + on-chain vault → real SUI transfer. Prevents LLM hallucinations from reaching the chain.</span>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Activity feed */}
              <Card className="lg:col-span-1">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-muted-foreground" /><CardTitle className="text-sm font-semibold">Activity feed</CardTitle></div>
                    <Button variant="ghost" size="sm" className="h-7 px-2" onClick={fetchRequests}>Refresh</Button>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="max-h-[640px] overflow-y-auto scrollbar-slim space-y-2 pr-1">
                    {requests.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center"><Activity className="h-8 w-8 text-muted-foreground/40 mb-2" /><p className="text-sm text-muted-foreground">No activity yet.</p><p className="text-xs text-muted-foreground/70">Send an instruction →</p></div>
                    ) : requests.map(req => <ActivityCard key={req.id} req={req} />)}
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Rules tab */}
          <TabsContent value="rules">
            <RulesTab rules={rules} vault={vault} commit={commit} tamper={tamper} ownerAuth={ownerAuth} onLoginClick={() => setLoginOpen(true)} onRefresh={fetchRules} aliases={aliases} />
          </TabsContent>

          {/* Architecture tab */}
          <TabsContent value="architecture"><ArchitectureTab /></TabsContent>
        </Tabs>
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t border-border bg-muted/20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5"><Shield className="h-3 w-3" /><span><strong className="text-foreground">Veto</strong> — off-chain policy engine is the runtime; on-chain vault is the backstop. Both must agree.</span></div>
            <div className="font-mono"><span>Sui Overflow 2026 · Agentic Web · API: {API_URL}</span></div>
          </div>
        </div>
      </footer>

      {/* Confirmation dialog */}
      <Dialog open={confirmDlg.open} onOpenChange={o => !confirmDlg.busy && setConfirmDlg(s => ({ ...s, open: o }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />Confirm the agent's intent</DialogTitle>
            <DialogDescription>The LLM parsed your message. Verify it's correct — this is the hallucination guard.</DialogDescription>
          </DialogHeader>
          {confirmDlg.intent && (
            <div className="space-y-3 py-2">
              <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">You said</div><div className="rounded-md border border-border bg-muted/30 p-2 text-sm font-mono">"{confirmDlg.raw}"</div></div>
              <div><div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">Agent will execute</div>
                <div className="rounded-md border border-foreground/30 bg-foreground/5 p-3 space-y-2">
                  <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Action</span><span className="font-mono font-semibold">transfer</span></div>
                  <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">Amount</span><span className="font-mono font-semibold">{confirmDlg.intent.amountSui} SUI</span></div>
                  <div className="flex items-start justify-between text-sm gap-2"><span className="text-muted-foreground">Recipient</span><div className="text-right min-w-0">{confirmDlg.intent.recipientAlias && <div className="font-mono font-semibold">{confirmDlg.intent.recipientAlias} →</div>}<code className="text-[10px] text-muted-foreground">{truncateAddress(confirmDlg.intent.recipient, 10)}</code></div></div>
                </div>
              </div>
              {confirmDlg.diff && confirmDlg.diff.amountMentioned !== null && confirmDlg.diff.amountMentioned !== confirmDlg.diff.amountParsed && (
                <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-2 text-xs flex items-start gap-2"><AlertTriangle className="h-3 w-3 text-amber-600 mt-0.5 flex-shrink-0" /><span className="text-amber-800 dark:text-amber-300"><strong>Diff:</strong> You mentioned {confirmDlg.diff.amountMentioned} SUI but the LLM parsed {confirmDlg.diff.amountParsed} SUI.</span></div>
              )}
            </div>
          )}
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => handleConfirm("reject")} disabled={confirmDlg.busy}><XCircle className="h-4 w-4 mr-1" />Reject</Button>
            <Button onClick={() => handleConfirm("confirm")} disabled={confirmDlg.busy}>{confirmDlg.busy ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}Confirm & execute</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Login dialog */}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Lock className="h-4 w-4" />Owner login</DialogTitle>
            <DialogDescription>The Owner role is required to edit rules. In production, this is backed by an on-chain OwnerCap capability object.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div><label className="text-[10px] uppercase tracking-wider text-muted-foreground">Owner password</label><Input type="password" value={loginPw} onChange={e => setLoginPw(e.target.value)} onKeyDown={e => { if (e.key === "Enter") handleLogin(); }} placeholder="Enter password" className="font-mono text-sm" autoFocus /></div>
          </div>
          <DialogFooter className="gap-2"><Button variant="outline" onClick={() => setLoginOpen(false)} disabled={loggingIn}>Cancel</Button><Button onClick={handleLogin} disabled={loggingIn || !loginPw}>{loggingIn && <Loader2 className="h-4 w-4 animate-spin mr-1" />}Log in</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Activity Card ───
function ActivityCard({ req }: { req: AgentRequest }) {
  return (
    <div className={`rounded-md border p-3 text-xs ${req.status === "EXECUTED" ? "border-emerald-300/50 bg-emerald-50/40 dark:border-emerald-800/50 dark:bg-emerald-950/10" : req.status === "BLOCKED" ? "border-red-300/50 bg-red-50/40 dark:border-red-800/50 dark:bg-red-950/10" : req.status === "FAILED" ? "border-amber-300/50 bg-amber-50/40 dark:border-amber-800/50 dark:bg-amber-950/10" : req.status === "AWAITING_CONFIRMATION" ? "border-blue-300/50 bg-blue-50/40 dark:border-blue-800/50 dark:bg-blue-950/10" : "border-border bg-muted/20"}`}>
      <div className="flex items-start justify-between gap-2 mb-1.5"><StatusBadge status={req.status} /><span className="font-mono text-[10px] text-muted-foreground">{formatTime(req.createdAt)}</span></div>
      <div className="mb-1.5 font-mono text-[11px] text-foreground/90 line-clamp-2">"{req.rawMessage}"</div>
      {req.amountSui !== null && <div className="mb-1.5 flex items-center gap-2 text-[11px]"><span className="text-muted-foreground">intent:</span><span className="font-mono">transfer {req.amountSui} SUI → <code className="text-foreground/80">{truncateAddress(req.recipient || "", 6)}</code></span></div>}
      {req.failedRule && <div className="mb-1.5 text-[11px]"><span className="text-muted-foreground">{req.failedRule === "user_rejected" ? "rejected by:" : req.failedRule.startsWith("on_chain_vault:") ? "on-chain vault:" : "blocked by:"}</span> <span className={`font-semibold ${req.failedRule.startsWith("on_chain_vault:") ? "text-amber-700 dark:text-amber-300" : "text-red-700 dark:text-red-300"}`}>{req.failedRule.replace("on_chain_vault:", "").replace(/_/g, " ")}</span>{req.failReason && <div className="mt-0.5 text-[10px] text-muted-foreground italic">{req.failReason}</div>}</div>}
      {req.status === "FAILED" && !req.failedRule && req.failReason && <div className="mb-1.5 text-[11px] text-amber-700 dark:text-amber-300">{req.failReason}</div>}
      {req.txDigest && <a href={`https://testnet.suivision.xyz/txblock/${req.txDigest}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10px] font-mono text-emerald-700 dark:text-emerald-300 hover:underline">tx {truncateAddress(req.txDigest, 6)}<ExternalLink className="h-2.5 w-2.5" /></a>}
    </div>
  );
}

// ─── Rules Tab ───
function RulesTab({ rules, vault, commit, tamper, ownerAuth, onLoginClick, onRefresh, aliases }: any) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState("MAX_AMOUNT_PER_TX");
  const [newMax, setNewMax] = useState("5");
  const [newCap, setNewCap] = useState("20");
  const [newAddrs, setNewAddrs] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);

  const ownerFetch = async (url: string, opts?: RequestInit) => {
    const r = await apiFetch(url, opts);
    if (r.status === 401) { toast.error("Owner login required"); throw new Error("Unauthorized"); }
    return r;
  };

  const toggle = async (rule: Rule) => {
    if (!ownerAuth) { onLoginClick(); return; }
    setBusy(rule.id);
    try {
      const r = await ownerFetch(`/api/rules/${rule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: !rule.enabled }) });
      const d = await r.json(); if (d.commit?.commitDurationMs !== undefined) setLastMs(d.commit.commitDurationMs);
      await onRefresh(); toast.success(`Rule ${rule.enabled ? "disabled" : "enabled"}`);
    } catch {} finally { setBusy(null); }
  };

  const del = async (rule: Rule) => {
    if (!ownerAuth) { onLoginClick(); return; }
    if (!confirm(`Delete "${rule.name}"?`)) return;
    setBusy(rule.id);
    try { await ownerFetch(`/api/rules/${rule.id}`, { method: "DELETE" }); await onRefresh(); toast.success("Rule deleted"); } catch {} finally { setBusy(null); }
  };

  const add = async () => {
    if (!ownerAuth) { onLoginClick(); return; }
    if (!newName.trim()) { toast.error("Name required"); return; }
    setSaving(true);
    try {
      let config: any = {};
      if (newType === "MAX_AMOUNT_PER_TX") config = { maxAmountSui: Number(newMax) };
      else if (newType === "DAILY_SPEND_CAP") config = { capSui: Number(newCap) };
      else config = { addresses: newAddrs.split(/[\s,]+/).filter(Boolean) };
      await ownerFetch("/api/rules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newName.trim(), type: newType, config }) });
      toast.success("Rule added"); setShowAdd(false); setNewName(""); setNewAddrs(""); await onRefresh();
    } catch {} finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      {tamper?.tampered && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-950/30">
          <CardContent className="py-3 flex items-start gap-3 text-xs"><AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" /><div className="flex-1"><strong className="text-red-800 dark:text-red-300">RULE BOOK TAMPERING DETECTED.</strong> <span className="text-red-700">DB rules don't match the last committed hash.</span><div className="mt-2 font-mono text-[10px] text-red-700"><div>committed: {tamper.committedHash}</div><div>current:&nbsp;&nbsp; {tamper.currentHash}</div></div></div></CardContent>
        </Card>
      )}
      <Card className={ownerAuth ? "border-emerald-300/50 bg-emerald-50/40 dark:border-emerald-800/50 dark:bg-emerald-950/10" : "border-amber-300/50 bg-amber-50/40 dark:border-amber-800/50 dark:bg-amber-950/10"}>
        <CardContent className="py-3 flex items-center gap-3 text-xs"><Lock className={`h-4 w-4 flex-shrink-0 ${ownerAuth ? "text-emerald-600" : "text-amber-600"}`} /><div className="flex-1">{ownerAuth ? <><strong className="text-emerald-800 dark:text-emerald-300">Owner authenticated.</strong> <span className="text-muted-foreground">Session cookie active.</span></> : <><strong className="text-amber-800 dark:text-amber-300">Owner login required.</strong> <button onClick={onLoginClick} className="underline text-foreground hover:text-amber-700">Log in →</button></>}{lastMs !== null && <div className="mt-1.5 text-[10px] font-mono text-muted-foreground">Last commit: <strong>{(lastMs / 1000).toFixed(3)}s</strong></div>}</div></CardContent>
      </Card>

      {vault && commit && (
        <Card>
          <CardHeader><div className="flex items-center justify-between"><div className="flex items-center gap-2"><Fingerprint className="h-4 w-4 text-muted-foreground" /><CardTitle className="text-base">On-chain rule book commit</CardTitle></div><Badge variant="outline" className="font-mono text-[10px] gap-1"><AlertTriangle className="h-2.5 w-2.5 text-amber-500" />SIMULATED</Badge></div><CardDescription className="text-xs mt-1">SHA-256 hash of the canonical rule set. Tamper-evident: any silent change shows up as a mismatch.</CardDescription></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
              <div className="rounded-md border border-border bg-muted/30 p-3"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Version</div><div className="font-mono text-lg font-bold">v{commit.version}</div></div>
              <div className="rounded-md border border-border bg-muted/30 p-3 sm:col-span-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Commit hash (SHA-256)</div><code className="text-[11px] font-mono break-all">{commit.commitHash || "—"}</code></div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-3 text-xs">
              <div className="rounded-md border border-border bg-muted/30 p-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Per-tx cap</div><div className="font-mono font-semibold">{mistToSui(vault.config.perTxCapMist).toFixed(2)} SUI</div></div>
              <div className="rounded-md border border-border bg-muted/30 p-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Daily cap</div><div className="font-mono font-semibold">{mistToSui(vault.config.dailyCapMist).toFixed(2)} SUI</div></div>
              <div className="rounded-md border border-border bg-muted/30 p-2"><div className="text-[10px] uppercase tracking-wider text-muted-foreground">Spent today</div><div className="font-mono font-semibold">{mistToSui(vault.spentTodayMist).toFixed(4)} SUI</div></div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><div className="flex items-center justify-between"><div><CardTitle className="text-base">Off-chain rule book</CardTitle><CardDescription className="text-xs mt-1">Deterministic rules evaluated by the policy engine. Both off-chain rules AND on-chain vault caps must pass.</CardDescription></div><Button size="sm" onClick={() => setShowAdd(s => !s)}><Plus className="h-3.5 w-3.5" /><span className="ml-1">Add rule</span></Button></div></CardHeader>
        <CardContent className="space-y-3">
          {showAdd && (
            <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div><label className="text-[10px] uppercase tracking-wider text-muted-foreground">Name</label><Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Per-tx cap" className="text-sm" /></div>
                <div><label className="text-[10px] uppercase tracking-wider text-muted-foreground">Type</label><select value={newType} onChange={e => setNewType(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"><option value="MAX_AMOUNT_PER_TX">Max per tx</option><option value="DAILY_SPEND_CAP">Daily cap</option><option value="ALLOWED_RECIPIENT">Allowlist</option><option value="DENYLIST_ADDRESS">Denylist</option></select></div>
                <div>{(newType === "MAX_AMOUNT_PER_TX" || newType === "DAILY_SPEND_CAP") ? (<><label className="text-[10px] uppercase tracking-wider text-muted-foreground">{newType === "MAX_AMOUNT_PER_TX" ? "Max SUI" : "Cap SUI"}</label><Input type="number" step="0.1" value={newType === "MAX_AMOUNT_PER_TX" ? newMax : newCap} onChange={e => newType === "MAX_AMOUNT_PER_TX" ? setNewMax(e.target.value) : setNewCap(e.target.value)} className="text-sm font-mono" /></>) : <div className="hidden sm:block" />}</div>
              </div>
              {(newType === "ALLOWED_RECIPIENT" || newType === "DENYLIST_ADDRESS") && <div><label className="text-[10px] uppercase tracking-wider text-muted-foreground">Addresses (comma-separated)</label><Input value={newAddrs} onChange={e => setNewAddrs(e.target.value)} placeholder="0xabc..., 0xdef..." className="text-sm font-mono" /></div>}
              <div className="flex justify-end gap-2"><Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>Cancel</Button><Button size="sm" onClick={add} disabled={saving}>{saving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}Save</Button></div>
            </div>
          )}
          <Separator />
          {rules.length === 0 ? <div className="py-12 text-center text-sm text-muted-foreground">No rules yet.</div> : rules.map((rule: Rule) => {
            const cfg = parseConfig(rule.config);
            let summary = "";
            if (rule.type === "MAX_AMOUNT_PER_TX") summary = `Block above ${cfg.maxAmountSui} SUI`;
            else if (rule.type === "DAILY_SPEND_CAP") summary = `Block when 24h total > ${cfg.capSui} SUI`;
            else if (rule.type === "ALLOWED_RECIPIENT") summary = `Only allow ${cfg.addresses?.length || 0} addresses`;
            else if (rule.type === "DENYLIST_ADDRESS") summary = `Block ${cfg.addresses?.length || 0} addresses`;
            return (
              <div key={rule.id} className={`flex items-center justify-between gap-3 rounded-md border border-border p-3 ${rule.enabled ? "bg-card" : "bg-muted/20 opacity-60"}`}>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2 mb-0.5"><span className="text-sm font-semibold">{rule.name}</span><Badge variant="outline" className="font-mono text-[10px]">{rule.type.replace(/_/g, " ").toLowerCase()}</Badge></div><div className="text-xs text-muted-foreground">{summary}</div></div>
                <div className="flex items-center gap-1">{busy === rule.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}<Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => toggle(rule)} disabled={busy === rule.id}><Power className={`h-3.5 w-3.5 ${rule.enabled ? "text-emerald-600" : "text-muted-foreground"}`} /></Button><Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-red-600" onClick={() => del(rule)} disabled={busy === rule.id}><Trash2 className="h-3.5 w-3.5" /></Button></div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Architecture Tab ───
function ArchitectureTab() {
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Architecture</CardTitle><CardDescription className="text-xs mt-1">Two enforcement layers: off-chain policy engine (runtime) + on-chain vault (backstop). Both must agree for a transaction to land.</CardDescription></CardHeader>
      <CardContent>
        <pre className="overflow-x-auto rounded-md border border-border bg-muted/30 p-4 text-[10px] font-mono leading-relaxed text-foreground/90">{`Frontend (Vercel)          Backend (Render)           Database (Neon)
┌──────────────┐           ┌──────────────────┐       ┌──────────────┐
│  Next.js     │  fetch()  │  Hono API Server │       │  PostgreSQL  │
│  Dashboard   │ ────────▶ │  /api/* routes   │ ────▶ │  Prisma ORM  │
│  (React)     │  cookie   │                  │       │              │
└──────────────┘  +cred    └──────┬───────────┘       └──────────────┘
                                 │
                      ┌──────────┼──────────┐
                      │          │          │
                      ▼          ▼          ▼
               ┌─────────┐ ┌─────────┐ ┌─────────┐
               │  Sui    │ │ Upstash │ │Anthropic│
               │ Testnet │ │  Redis  │ │  Claude │
               │  RPC    │ │ (rate   │ │  (LLM   │
               │         │ │  limit) │ │  parse) │
               └─────────┘ └─────────┘ └─────────┘

Contracts (Sui Testnet):
┌──────────────────────────────────────────────┐
│  veto::vault Move module                     │
│  ├─ OwnerCap (capability object)             │
│  ├─ Vault (shared object, holds funds)       │
│  ├─ spend() — atomic check + increment       │
│  ├─ commit_rules() — requires OwnerCap       │
│  └─ configure() — requires OwnerCap          │
└──────────────────────────────────────────────┘`}</pre>
        <Separator className="my-4" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <h4 className="font-semibold mb-1.5 text-sm">Stack</h4>
            <ul className="space-y-0.5 text-muted-foreground">
              <li><strong className="text-foreground">Frontend:</strong> Next.js 16 + Tailwind + shadcn/ui</li>
              <li><strong className="text-foreground">Backend:</strong> Hono + TypeScript on Render</li>
              <li><strong className="text-foreground">DB:</strong> Prisma + PostgreSQL on Neon</li>
              <li><strong className="text-foreground">Redis:</strong> Upstash (rate limiting)</li>
              <li><strong className="text-foreground">Chain:</strong> Sui Testnet via @mysten/sui v2</li>
              <li><strong className="text-foreground">On-chain:</strong> Move module veto::vault</li>
              <li><strong className="text-foreground">LLM:</strong> Anthropic Claude (swappable)</li>
              <li><strong className="text-foreground">Auth:</strong> OwnerCap + signed cookie</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold mb-1.5 text-sm">The single sentence that matters</h4>
            <blockquote className="border-l-2 border-foreground/30 pl-3 italic text-foreground/80">The off-chain policy engine is the runtime. The on-chain vault is the backstop. Both must agree for a transaction to land. If the off-chain engine is compromised, the on-chain caps still hold.</blockquote>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
