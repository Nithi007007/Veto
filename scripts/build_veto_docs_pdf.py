#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Veto — Complete Documentation PDF generator.
Uses ReportLab to produce a professional PDF with cover, TOC, and all 23 sections.
"""

import os
import sys
import hashlib
import re

PDF_SKILL_DIR = '/home/z/my-project/skills/pdf'
sys.path.insert(0, os.path.join(PDF_SKILL_DIR, 'scripts'))

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, mm
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_RIGHT, TA_CENTER, TA_JUSTIFY
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, PageBreak, Spacer, Table, TableStyle,
    KeepTogether, CondPageBreak, HRFlowable, Preformatted
)
from reportlab.platypus.tableofcontents import TableOfContents

# ───────────────────────── FONT REGISTRATION ─────────────────────────
FONT_DIR = '/usr/share/fonts'
pdfmetrics.registerFont(TTFont('NotoSerifSC', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSC-Bold', f'{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif', f'{FONT_DIR}/truetype/freefont/FreeSerif.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Bold', f'{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-Italic', f'{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf'))
pdfmetrics.registerFont(TTFont('FreeSerif-BoldItalic', f'{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans', f'{FONT_DIR}/truetype/dejavu/DejaVuSansMono.ttf'))

registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSC-Bold')
registerFontFamily('FreeSerif', normal='FreeSerif', bold='FreeSerif-Bold',
                   italic='FreeSerif-Italic', boldItalic='FreeSerif-BoldItalic')

try:
    from pdf import install_font_fallback
    install_font_fallback()
except Exception:
    pass

# ───────────────────────── PALETTE ─────────────────────────
PAGE_BG       = colors.HexColor('#f0f0f1')
SECTION_BG    = colors.HexColor('#eeeff0')
CARD_BG       = colors.HexColor('#e9eced')
TABLE_STRIPE  = colors.HexColor('#eaebec')
HEADER_FILL   = colors.HexColor('#475b66')
COVER_BLOCK   = colors.HexColor('#536e7b')
BORDER        = colors.HexColor('#b2c3cc')
ICON          = colors.HexColor('#416f85')
ACCENT        = colors.HexColor('#2b6886')
ACCENT_2      = colors.HexColor('#b76e4a')
TEXT_PRIMARY  = colors.HexColor('#151617')
TEXT_MUTED    = colors.HexColor('#80878a')
SEM_SUCCESS   = colors.HexColor('#437a55')
SEM_WARNING   = colors.HexColor('#93773d')
SEM_ERROR     = colors.HexColor('#964e47')

TABLE_HEADER_COLOR = HEADER_FILL
TABLE_HEADER_TEXT  = colors.white
TABLE_ROW_EVEN     = colors.white
TABLE_ROW_ODD      = TABLE_STRIPE

# ───────────────────────── STYLES ─────────────────────────
H1 = ParagraphStyle(name='H1', fontName='FreeSerif-Bold', fontSize=18, leading=24,
                    textColor=HEADER_FILL, spaceBefore=18, spaceAfter=10, alignment=TA_LEFT)
H2 = ParagraphStyle(name='H2', fontName='FreeSerif-Bold', fontSize=13, leading=18,
                    textColor=ACCENT, spaceBefore=12, spaceAfter=6, alignment=TA_LEFT)
H3 = ParagraphStyle(name='H3', fontName='FreeSerif-Bold', fontSize=11, leading=15,
                    textColor=HEADER_FILL, spaceBefore=8, spaceAfter=4, alignment=TA_LEFT)
BODY = ParagraphStyle(name='Body', fontName='FreeSerif', fontSize=10, leading=15,
                      textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=6)
BODY_LEFT = ParagraphStyle(name='BodyLeft', parent=BODY, alignment=TA_LEFT)
BULLET = ParagraphStyle(name='Bullet', parent=BODY, leftIndent=18, bulletIndent=4,
                        spaceAfter=3, alignment=TA_LEFT)
CODE = ParagraphStyle(name='Code', fontName='DejaVuSans', fontSize=8.5, leading=12,
                      textColor=TEXT_PRIMARY, alignment=TA_LEFT, spaceBefore=4, spaceAfter=8,
                      leftIndent=8, rightIndent=8)
META = ParagraphStyle(name='Meta', fontName='FreeSerif', fontSize=8.5, leading=12,
                      textColor=TEXT_MUTED, alignment=TA_LEFT)
TBL_HDR = ParagraphStyle(name='TblHdr', fontName='FreeSerif-Bold', fontSize=9, leading=11,
                         textColor=colors.white, alignment=TA_CENTER)
TBL_CELL = ParagraphStyle(name='TblCell', fontName='FreeSerif', fontSize=8.5, leading=11,
                          textColor=TEXT_PRIMARY, alignment=TA_LEFT)
TBL_CELL_C = ParagraphStyle(name='TblCellC', parent=TBL_CELL, alignment=TA_CENTER)
TBL_CELL_BOLD = ParagraphStyle(name='TblCellBold', parent=TBL_CELL, fontName='FreeSerif-Bold')

TOC_L0 = ParagraphStyle(name='TOC0', fontName='FreeSerif-Bold', fontSize=11, leading=18,
                        leftIndent=0, textColor=HEADER_FILL)
TOC_L1 = ParagraphStyle(name='TOC1', fontName='FreeSerif', fontSize=10, leading=15,
                        leftIndent=18, textColor=TEXT_PRIMARY)


# ───────────────────────── HELPERS ─────────────────────────
class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, 'bookmark_name'):
            level = getattr(flowable, 'bookmark_level', 0)
            text = getattr(flowable, 'bookmark_text', '')
            key = getattr(flowable, 'bookmark_key', '')
            self.notify('TOCEntry', (level, text, self.page, key))


def add_heading(text, style, level=0):
    key = 'h_' + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph('<a name="%s"/>%s' % (key, text), style)
    p.bookmark_name = text
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p


def add_major_section(text):
    return [CondPageBreak(120), add_heading(text, H1, level=0)]


def add_subsection(text):
    return add_heading(text, H2, level=1)


def para(text, style=BODY):
    return Paragraph(text, style)


def code_block(text):
    """Render a code block preserving whitespace."""
    # Escape HTML special chars
    escaped = text.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
    # Preserve line breaks
    escaped = escaped.replace('\n', '<br/>')
    # Preserve leading spaces (non-breaking)
    escaped = re.sub(r'^( +)', lambda m: '&nbsp;' * len(m.group(1)), escaped, flags=re.MULTILINE)
    return Paragraph(escaped, CODE)


def make_table(data_rows, col_ratios=None, header=True):
    avail = A4[0] - 2 * inch
    n_cols = len(data_rows[0])
    if col_ratios is None:
        col_widths = [avail / n_cols] * n_cols
    else:
        col_widths = [r * avail for r in col_ratios]

    wrapped = []
    for i, row in enumerate(data_rows):
        wrow = []
        for j, cell in enumerate(row):
            if i == 0 and header:
                wrow.append(Paragraph(f'<b>{cell}</b>', TBL_HDR))
            else:
                wrow.append(Paragraph(str(cell), TBL_CELL))
        wrapped.append(wrow)

    tbl = Table(wrapped, colWidths=col_widths, hAlign='CENTER', repeatRows=1 if header else 0)
    style = [
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('GRID', (0, 0), (-1, -1), 0.3, BORDER),
    ]
    if header:
        style += [
            ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_COLOR),
            ('TEXTCOLOR', (0, 0), (-1, 0), TABLE_HEADER_TEXT),
        ]
        for i in range(1, len(data_rows)):
            bg = TABLE_ROW_EVEN if i % 2 == 1 else TABLE_ROW_ODD
            style.append(('BACKGROUND', (0, i), (-1, i), bg))
    tbl.setStyle(TableStyle(style))
    return tbl


# ───────────────────────── PAGE DECORATION ─────────────────────────
def add_page_decoration(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.3)
    canvas.line(inch, 0.6 * inch, A4[0] - inch, 0.6 * inch)
    canvas.setFont('FreeSerif', 8)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(inch, 0.42 * inch,
                      'Veto — Complete Project Documentation')
    canvas.drawRightString(A4[0] - inch, 0.42 * inch, f'Page {doc.page}')
    canvas.setFillColor(ACCENT)
    canvas.rect(0, A4[1] - 6, A4[0], 6, fill=1, stroke=0)
    canvas.restoreState()


# ───────────────────────── BUILD STORY ─────────────────────────
story = []

# ─── TOC ───
story.append(Paragraph('<b>Table of Contents</b>',
                       ParagraphStyle('toctitle', fontName='FreeSerif-Bold', fontSize=22,
                                      leading=28, textColor=HEADER_FILL,
                                      alignment=TA_LEFT, spaceAfter=18)))
story.append(HRFlowable(width='100%', thickness=1.2, color=ACCENT,
                        spaceBefore=0, spaceAfter=18))
toc = TableOfContents()
toc.levelStyles = [TOC_L0, TOC_L1]
story.append(toc)
story.append(PageBreak())


# ═══════════════════════════════════════════════════════════════
# Section 1: What is Veto
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('1. What is Veto'))

story.append(para(
    'Veto is a <b>deterministic, verifiable policy gate</b> that sits between an AI agent\'s '
    'reasoning and its on-chain wallet. Every proposed transaction must pass a fixed, '
    'human-defined rule book — evaluated in plain TypeScript code, not by another model — '
    'before it can be signed and submitted to the Sui blockchain. The rule book itself is '
    'fingerprinted on-chain, so even the rules can\'t be silently changed without it being visible.'
))

story.append(para(
    'Two roles exist even though one app runs both: the <b>Owner</b> (sets policy via /rules, '
    'authenticated) and the <b>Agent</b> (proposes actions via chat, untrusted). The deterministic '
    'policy engine is the wall between them. That wall, and its on-chain fingerprint, is the entire pitch.'
))


# ═══════════════════════════════════════════════════════════════
# Section 2: The Pitch
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('2. The Pitch in One Paragraph'))

story.append(para(
    'AI agents are starting to hold real wallets. Most agent frameworks let the model decide '
    '<i>and</i> execute in the same step. One bad instruction, one prompt injection, one '
    'hallucination, and funds move. <b>Veto puts two enforcement layers between an agent\'s '
    'reasoning and its wallet:</b> an off-chain deterministic policy engine (runtime, fast, '
    'editable) AND an on-chain vault (backstop, hard-capped, tamper-evident). Both must agree '
    'for a transaction to land. If the off-chain engine is compromised, the on-chain caps still '
    'hold. If a rule is silently edited, the on-chain commit hash diverges from what the feed '
    'shows was enforced.'
))

story.append(Spacer(1, 6))
story.append(Paragraph(
    '<b>The single sentence that matters:</b> The off-chain policy engine is the runtime. '
    'The on-chain vault is the backstop. Both must agree for a transaction to land. If the '
    'off-chain engine is compromised, the on-chain caps still hold.',
    ParagraphStyle('callout', fontName='FreeSerif-Italic', fontSize=11, leading=16,
                   textColor=ACCENT, leftIndent=12, rightIndent=12, spaceBefore=6,
                   spaceAfter=10, alignment=TA_LEFT, borderColor=ACCENT, borderWidth=0)
))


# ═══════════════════════════════════════════════════════════════
# Section 3: Evidence
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('3. Evidence: Real AI Agents Currently Hold Wallets'))

story.append(para(
    'This is not future-tense. It is a documented present-tense market. The "AI agents are '
    'starting to hold real wallets" claim is a documented fact, not a bet on the future.'
))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Agent', 'What it is', 'Wallet capability'],
    ['Truth Terminal', 'Claude-based autonomous AI agent (a16z-backed)', 'Holds GOAT token, autonomously promotes/posts, $280K+ market cap'],
    ['ElizaOS (ai16z Eliza)', 'Open-source agent framework', 'Native wallet plugins on Solana, Sui, Base; Stanford partnership'],
    ['Coinbase Agentic Wallets', 'Launched Feb 11, 2026', 'MPC-secured wallet with programmable spending limits, session caps'],
    ['Dysnix, Cobo, Turnkey, Safe', 'Wallet infrastructure providers', 'All shipping agent-wallet products in 2025-2026'],
], col_ratios=[0.20, 0.35, 0.45]))
story.append(Spacer(1, 8))


# ═══════════════════════════════════════════════════════════════
# Section 4: Threat Model
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('4. The Threat Model (T1-T6)'))

story.append(para(
    'Every threat is named, mitigated, and (where possible) demo-able live. The two soft spots '
    'historically — T4 (rule book tampering) and T6 (Owner/Agent boundary) — are now the strongest '
    'demo moments in the project.'
))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Threat', 'Scenario', 'Mitigation', 'Demo-able?'],
    ['T1 Prompt injection', 'Agent reads untrusted external content with hidden instruction', 'Policy engine evaluates final intent regardless of how it was produced', 'Yes'],
    ['T2 LLM hallucination', 'Model fabricates amount/recipient', 'zod validation + hard caps + two-step confirmation', 'Yes'],
    ['T3 Compromised LLM response', 'MITM injects fake completion', 'Policy engine doesn\'t trust upstream — zero LLM imports', 'Architecturally shown'],
    ['T4 Rule book tampering', 'Someone edits rules directly in DB', 'On-chain commit hash; UI recomputes local hash, shows red banner on mismatch', 'YES — verified live'],
    ['T5 Replay / double-submit', 'Network retry executes same transfer twice', 'Idempotency key (hash of msg+amount+recipient), 60s window', 'Yes'],
    ['T6 Owner/Agent boundary', 'Anyone could call /api/rules', 'OWNER_PASSWORD + signed cookie + on-chain OwnerCap (production)', 'YES — verified via curl'],
], col_ratios=[0.18, 0.27, 0.40, 0.15]))
story.append(Spacer(1, 8))


# ═══════════════════════════════════════════════════════════════
# Section 5: Three Layers of Defense
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('5. The Three Layers of Defense'))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Layer', 'What it does', 'Threat mitigated'],
    ['1. Two-step confirmation (UI)', 'LLM parses intent -> user must explicitly confirm before any policy check or chain call', 'T2, T3'],
    ['2. Off-chain policy engine (TS)', 'Deterministic rule checks. Zero API calls inside the policy function. Fail-closed when zero rules enabled.', 'T1'],
    ['3. On-chain vault (Move)', 'Hard per_tx_cap + daily_cap enforced atomically in vault::spend(). OwnerCap pattern: protocol-level authorization.', 'T4, T6'],
    ['4. Idempotency key (T5)', 'Hash of (message + amount + recipient) checked against recent EXECUTED requests. 60-second window.', 'T5'],
], col_ratios=[0.28, 0.52, 0.20]))
story.append(Spacer(1, 8))

story.append(add_subsection('The confirmation flow (hallucination guard)'))
story.append(code_block("""User types "send 100 sui to alice"
        |
LLM parses -> {action: transfer, amountSui: 100, recipient: "alice"}
        |
UI displays confirmation dialog:
  "You said: send 100 sui to alice"
  "Agent will execute: transfer 100 SUI -> 0x...0bad"
  [diff warning if amount/recipient differs from what was mentioned]
        |
User clicks "Confirm & execute" or "Reject"
        |
Only then does the policy engine + on-chain vault check + SUI execution run"""))


# ═══════════════════════════════════════════════════════════════
# Section 6: Owner/Agent Boundary
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('6. The Owner / Agent Trust Boundary'))

story.append(para(
    'Two roles, one app, in v1: the <b>Owner</b> edits the rule book via /rules (every change '
    're-commits the rule hash on-chain, authenticated via x-owner-token header in v1, NextAuth + '
    'zkLogin in v1.1). The <b>Agent</b> is the chat/LLM path — it can ONLY propose actions via '
    '/api/agent/message, with no route, permission, or code path that touches /api/rules.'
))

story.append(para(
    'The deterministic policy engine sits between them. <b>The Agent literally cannot modify the '
    'rules</b> — the requireOwner() middleware in src/lib/auth.ts rejects any request to /api/rules* '
    'without the owner token. Verified live in the network panel during demo.'
))

story.append(para(
    'In production (Move deployed), the boundary is enforced one layer deeper at the chain itself: '
    'the commit_rules() and configure() functions take _: &OwnerCap as their first argument. The '
    'Sui runtime rejects any tx that doesn\'t include the OwnerCap object BEFORE the function body runs.'
))


# ═══════════════════════════════════════════════════════════════
# Section 7: Why Sui
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('7. Why Sui Specifically (OwnerCap Pattern)'))

story.append(para(
    'The honest version of "why Sui": nothing in the basic pitch couldn\'t run on any chain with '
    'a require(msg.sender == owner) check. The Sui-specific version is the <b>OwnerCap capability '
    'pattern</b>.'
))

story.append(para(
    'The Move module is designed so updating the rule registry requires <i>possessing a capability '
    'object</i>, not just passing a permission check in code:'
))

story.append(code_block("""public struct OwnerCap has key, store {}

public fun commit_rules(
    _cap: &OwnerCap,
    registry: &mut Vault,
    new_hash: vector<u8>,
) {
    registry.rules_commit_hash = new_hash;
    registry.rules_version = registry.rules_version + 1;
}"""))

story.append(para(
    'On an account-based chain (Ethereum, Solana, etc.), "only the owner can do this" lives entirely '
    'inside mutable application code. On Sui, possessing the right object <i>is</i> the authorization — '
    'the runtime checks object ownership before your Move code even runs. A transaction that doesn\'t '
    'include the OwnerCap literally cannot call commit_rules or configure, full stop, at the protocol level.'
))

story.append(para(
    '<b>This is demo-able as fact, not asserted as a slide:</b> try the call without the cap in a Sui '
    'CLI terminal, show it get rejected on-chain, clip it or do it live. The app-level password '
    '(OWNER_PASSWORD env var + cookie) is for convenience — the actual authority boundary is enforced '
    'by the chain itself.'
))

story.append(add_subsection('Four Sui-specific primitives'))
for item in [
    '<b>Shared objects</b> — vault::spend() is a single atomic Move transaction protected by consensus (race-condition prevention)',
    '<b>Move resource safety</b> — funds inside the vault literally cannot be moved except via the vault\'s entry function (impossible in Solidity\'s storage model)',
    '<b>Sponsored transactions</b> — for v1.1 user-delegated wallets',
    '<b>OwnerCap capability pattern</b> — protocol-level authorization, not app-level',
]:
    story.append(Paragraph('• ' + item, BULLET))


# ═══════════════════════════════════════════════════════════════
# Section 8: System Architecture
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('8. System Architecture'))

story.append(code_block("""+--------------+  message   +--------------------+
|  Chat UI     | ---------> | POST /api/agent    |  <- Agent role
|  (Agent)     |            |   /message         |    (no owner cookie)
+--------------+            +---------+----------+
                                       | 1. LLM parse (zod-validated)
                                       v
                            status = AWAITING_CONFIRMATION
                                       |
                                       v
                            +--------------------+
                            | User confirms      |  <- hallucination guard (T2)
                            | parsed intent      |    (2-step flow)
                            +---------+----------+
                                       | POST /api/agent/confirm
                                       v
                            1a. IDEMPOTENCY CHECK (T5)
                                hash(msg+amount+recipient)
                                reject if EXECUTED in last 60s
                                       |
                                       v
                            2. ON-CHAIN VAULT pre-flight
                               (per_tx_cap, daily_cap)
                                       |
                                       v
                            3. OFF-CHAIN policy engine
                               (allowlist, denylist) - zero LLM calls (T1, T3)
                                       |
                        +--------------+--------------+
                        v fail                        v pass
                 BLOCKED                      4. Sign + execute via
                 (no chain call)                @mysten/sui (real testnet tx)
                                       |
                                       v
                            Persist + UI live feed

+--------------+  login     +--------------------+
|  /rules UI   | ---------> | POST /api/owner    |  <- Owner role
|  (Owner)     |            |   /login           |    (OWNER_PASSWORD
+------+-------+            | -> session cookie  |     -> signed cookie)
       |                    +--------------------+
       | edit rule (cookie)
       v
+--------------------+
| POST/PATCH         |  <- requireOwner() middleware
|  /api/rules        |    validates cookie OR x-owner-token
+---------+----------+
          | 5. Recompute SHA-256(rules JSON)
          v
+------------------------------+
| commit_rules(OwnerCap, ...)   |  <- In production: Sui runtime
| on Vault object               |    rejects tx if OwnerCap object
| (simulated in v1)             |    is not included (T6 enforced
+---------+---------------------+    at the protocol level)
          |
          v
+------------------------------+
| T4: tamper detection         |  <- On every GET /api/rules:
| recompute hash, compare      |    recompute local hash,
| to last commit               |    compare to last committed,
| -> tampered: boolean         |    show red banner if mismatch
+------------------------------+"""))

story.append(add_subsection('Request flow (the core pipeline)'))
for i, step in enumerate([
    '<b>User types</b> a plain-English instruction (send 1 sui to alice)',
    '<b>POST /api/agent/message</b> — LLM parses into {action, amountSui, recipient}, zod-validates the shape, resolves aliases to real Sui addresses, stores the request as AWAITING_CONFIRMATION, returns the parsed intent + diff to the UI',
    '<b>Confirmation dialog</b> shows original message + parsed intent side-by-side. If amount differs from any number mentioned, amber diff warning. User clicks "Confirm & execute" or "Reject"',
    '<b>POST /api/agent/confirm</b> runs the full pipeline: T5 idempotency check, on-chain vault pre-flight, off-chain policy engine (fail-closed if zero rules), SUI execution if all pass',
    '<b>Activity feed</b> updates live (polls every 4s), showing every request with status badge, parsed intent, failing rule or tx digest + explorer link',
]):
    story.append(Paragraph(f'{i+1}. {step}', BULLET))


# ═══════════════════════════════════════════════════════════════
# Section 9: Technology Stack
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('9. Technology Stack'))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Layer', 'Choice', 'Why'],
    ['Framework', 'Next.js 16 (App Router) + TypeScript', 'Modern, Vercel-native, serverless-friendly'],
    ['UI', 'Tailwind CSS + shadcn/ui', 'Polished components, consistent design, fast to build'],
    ['DB (local dev)', 'Prisma + SQLite', 'Zero-config offline dev'],
    ['DB (production)', 'Prisma + PostgreSQL on Neon (free tier)', 'SQLite does NOT work on Vercel — serverless filesystem resets per request'],
    ['Chain SDK', '@mysten/sui v2 (SuiJsonRpcClient, Ed25519Keypair, Transaction)', 'Current Sui SDK (not deprecated @mysten/sui.js)'],
    ['On-chain', 'Move module veto::vault', 'Production target; off-chain simulator mirrors semantics'],
    ['Wallet model', 'App-custodied single testnet keypair, server-side only', 'v1 simplification — v1.1 adds user-delegated wallets via dapp-kit'],
    ['LLM', 'z-ai-web-dev-sdk (swappable)', 'Already integrated in the env; abstracted so any provider works'],
    ['Validation', 'zod on every LLM output and API input', 'Defense in depth — never trust unvalidated data'],
    ['Auth', 'Owner password + signed HMAC session cookie (v1) -> on-chain OwnerCap (production)', 'Cookie for UX, OwnerCap for actual security boundary'],
    ['Idempotency', 'SHA-256 of (message + amount + recipient), 60s window', 'Prevents replay/double-submit (T5)'],
    ['Hosting', 'Vercel (Hobby/free) + Neon (free Postgres)', 'Both have free tiers, no credit card required for demo scale'],
], col_ratios=[0.18, 0.42, 0.40]))
story.append(Spacer(1, 8))


# ═══════════════════════════════════════════════════════════════
# Section 10: File Structure
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('10. File Structure'))

story.append(code_block("""veto/
|-- README.md                              <- Project-level overview
|-- VETO_COMPLETE_DOCUMENTATION.md         <- This file
|-- package.json                           <- Scripts: dev, build, test, test:api, pre-deploy
|-- vitest.config.ts                       <- Test config with @/ path alias
|-- next.config.ts                         <- Next.js 16 config
|-- tsconfig.json                          <- TypeScript config
|-- tailwind.config.ts                     <- Tailwind theme
|-- eslint.config.mjs                      <- ESLint rules
|-- .env / .env.example                    <- Environment variables (gitignored / template)
|-- .gitignore
|
|-- prisma/
|   |-- schema.prisma                      <- ACTIVE schema (sqlite or postgres)
|   |-- schema.sqlite.prisma               <- Local dev only - DO NOT DEPLOY
|   `-- schema.postgres.prisma             <- Production target (Vercel-safe)
|
|-- move/                                  <- Move smart contract source
|   `-- veto/
|       |-- Move.toml                      <- Package config
|       `-- sources/
|           `-- vault.move                 <- The on-chain vault (OwnerCap pattern)
|
|-- scripts/                               <- Operational scripts
|   |-- switch-db.sh                       <- Swap prisma schema between sqlite/postgres
|   `-- pre-deploy-check.sh                <- Fails loudly if SQLite is active
|
|-- tests/                                 <- Test suite
|   |-- policy-engine.test.ts              <- 19 unit tests for the rule logic (vitest)
|   |-- api-test.sh                        <- 10-step curl smoke test for the live API
|   `-- manual-test-checklist.md           <- Browser + chain-state verification checklist
|
`-- src/
    |-- app/                               <- Next.js App Router
    |   |-- layout.tsx                     <- Root layout (fonts, Toaster)
    |   |-- page.tsx                       <- Single-page dashboard (3 tabs + dialogs)
    |   |-- globals.css                    <- Tailwind + custom styles
    |   `-- api/                           <- API routes
    |       |-- agent/
    |       |   |-- message/route.ts       <- Step 1: LLM parse -> AWAITING_CONFIRMATION
    |       |   `-- confirm/route.ts       <- Step 2: idempotency + vault + policy + execute
    |       |-- owner/
    |       |   |-- login/route.ts         <- Password -> signed session cookie
    |       |   |-- logout/route.ts        <- Clear cookie
    |       |   `-- status/route.ts        <- { authenticated: boolean }
    |       |-- requests/route.ts          <- Activity feed (GET)
    |       |-- rules/
    |       |   |-- route.ts               <- List + create (owner-only on POST)
    |       |   `-- [id]/route.ts          <- Toggle/edit/delete (owner-only)
    |       |-- wallet/route.ts            <- Agent wallet address + balance (GET)
    |       |-- aliases/route.ts           <- Named address book (GET)
    |       `-- seed/route.ts              <- Seed default rules + initial commit
    |
    |-- lib/                               <- Business logic
    |   |-- policy-engine.ts               <- THE CORE: pure TS, zero LLM calls
    |   |-- vault.ts                       <- On-chain vault simulator + commit + tamper detection
    |   |-- sui.ts                         <- Sui testnet client + keypair + transfer
    |   |-- llm.ts                         <- Intent parser (z-ai-web-dev-sdk + zod)
    |   |-- auth.ts                        <- Owner password + signed HMAC cookie
    |   |-- aliases.ts                     <- Named address book
    |   |-- types.ts                       <- Shared TypeScript types
    |   `-- db.ts                          <- Prisma client singleton
    |
    `-- components/ui/                     <- shadcn/ui components"""))


# ═══════════════════════════════════════════════════════════════
# Section 11: File-by-File Logic
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('11. File-by-File Logic'))

# 11.1 policy-engine.ts
story.append(add_subsection('11.1 src/lib/policy-engine.ts — The Core'))
story.append(para(
    'This is the heart of the project. <b>Pure, synchronous, side-effect-free TypeScript.</b> '
    'No LLM call happens inside this module — that sentence is the whole pitch.'
))
story.append(para('Types:'))
story.append(code_block("""type ParsedIntent = { action: "transfer"; amountSui: number; recipient: string };
type PolicyContext = { spentTodaySui: number };
type PolicyDecision =
  | { decision: "APPROVED" }
  | { decision: "BLOCKED"; failedRule: string; reason: string };

// 4 rule types:
// - MAX_AMOUNT_PER_TX  -> { maxAmountSui: number }
// - DAILY_SPEND_CAP    -> { capSui: number }
// - DENYLIST_ADDRESS   -> { addresses: string[] }
// - ALLOWED_RECIPIENT  -> { addresses: string[] }"""))
story.append(para('Key design decisions:'))
for item in [
    '<b>Zero LLM imports</b> — the file imports nothing from llm.ts. Architecturally enforced: the policy engine is the last line of defense and cannot be influenced by model output.',
    '<b>Fail-closed on empty rule book</b> — an empty/misconfigured rule book must NOT mean "allow everything." If you want to allow everything, add an explicit MAX_AMOUNT_PER_TX rule with a very high cap.',
    '<b>Deterministic order</b> — rules are sorted by createdAt, so the audit trail is reproducible.',
    '<b>First-failure-wins</b> — only the first failing rule is reported, with a single clear reason. No cascading error noise.',
]:
    story.append(Paragraph('• ' + item, BULLET))

# 11.2 vault.ts
story.append(add_subsection('11.2 src/lib/vault.ts — On-chain Vault Simulator + Commit Logic'))
story.append(para(
    'Mirrors the semantics of move/veto/sources/vault.move exactly. In v1 (current): runs off-chain. '
    'In production: the same off-chain code calls vault::spend() instead of the local simulator, and '
    'the on-chain enforcement becomes authoritative.'
))
story.append(para('Key functions:'))
story.append(code_block("""// Default vault config: 5 SUI per-tx cap, 20 SUI daily cap
const DEFAULT_VAULT_CONFIG = {
  perTxCapMist: 5n * 1_000_000_000n,
  dailyCapMist: 20n * 1_000_000_000n,
};

// Get current vault state (computed from DB)
async function getVaultState(): Promise<VaultState>

// T4: tamper detection - recompute local hash, compare to last commit
async function detectTampering(): Promise<{ tampered, currentHash, committedHash, ... }>

// Compute SHA-256 hash of the canonical rule set (sorted, enabled-only)
function computeRulesHash(rules: Rule[]): string

// Commit the current rule set (simulated: stores hash + version in DB)
// Returns commitDurationMs so UI can show "committed in X.Xs"
async function commitRulesToVault(rules): Promise<VaultCommit & { commitDurationMs }>

// Pre-flight check: would this spend be allowed by the on-chain vault?
async function preflightVaultSpend(amountMist: bigint): Promise<VaultSpendResult>"""))

# 11.3 sui.ts
story.append(add_subsection('11.3 src/lib/sui.ts — Sui Integration'))
story.append(para(
    'Server-side only. The agent\'s testnet keypair is loaded from env and never sent to the client.'
))
story.append(code_block("""import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { MIST_PER_SUI } from "@mysten/sui/utils";

// Singleton client (lazy-initialized)
function getSuiClient(): SuiJsonRpcClient

// Singleton keypair (loaded from SUI_AGENT_SECRET_KEY env var)
function getAgentKeypair(): Ed25519Keypair

// Agent wallet address (derived from keypair)
function getAgentAddress(): string

// Get balance in whole SUI (not MIST)
async function getAgentBalanceSui(): Promise<number>

// THE ONLY FUNCTION THAT SIGNS ANYTHING.
// Only called AFTER policy engine approves.
async function executeTransfer(recipient, amountSui): Promise<TransferResult>"""))
story.append(para(
    'Key implementation detail: executeTransfer uses tx.splitCoins(tx.gas, [amount]) + '
    'tx.transferObjects([coin], recipient). The agent\'s own gas coin is the source, so no '
    'separate coin management needed. Pre-flight balance check prevents obvious failures.'
))

# 11.4 llm.ts
story.append(add_subsection('11.4 src/lib/llm.ts — Intent Parser'))
story.append(para(
    'One job: turn free-text user input into a structured ParsedIntent, or flag it as unparseable. '
    'The model\'s output is treated as untrusted — it goes through zod validation before being used '
    'anywhere downstream.'
))
story.append(para('Key design decisions:'))
for item in [
    '<b>Never throws</b> — on any error (LLM call fails, JSON parse fails, zod validation fails), returns {action: "unknown", reason: "..."}. The caller surfaces this to the user.',
    '<b>Markdown fence stripping</b> — LLMs sometimes wrap JSON in ```json fences despite instructions. Handle it gracefully.',
    '<b>JSON extraction</b> — if the model adds commentary around the JSON, extract just the {...} part.',
    '<b>zod validation</b> — schema check is the last gate before the intent is trusted.',
]:
    story.append(Paragraph('• ' + item, BULLET))

# 11.5 auth.ts
story.append(add_subsection('11.5 src/lib/auth.ts — Owner Authentication'))
story.append(para(
    'Two layers of authorization: app-level (v1) OWNER_PASSWORD + signed HMAC session cookie; '
    'chain-level (production) OwnerCap object on Sui.'
))
story.append(para('Key security details:'))
for item in [
    '<b>HMAC-signed cookie</b> — the cookie value is <expiresAt>.<hmac>. Tampering with expiresAt invalidates the HMAC.',
    '<b>Constant-time comparison</b> — diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i) prevents timing attacks.',
    '<b>HttpOnly + SameSite=Strict</b> — cookie can\'t be read by JavaScript, can\'t be sent on cross-site requests.',
    '<b>Backwards compat</b> — x-owner-token header still works for API clients (curl tests, CI).',
]:
    story.append(Paragraph('• ' + item, BULLET))

# 11.6-11.9 — Other lib files
story.append(add_subsection('11.6 src/lib/aliases.ts — Named Address Book'))
story.append(para(
    'Lets the demo say "send 5 SUI to alice" instead of pasting hex addresses on camera. Edit ALIASES '
    'with your own testnet addresses. resolveAlias(input) returns the Sui address for a known alias, '
    'or the input itself if it\'s already a valid 0x-prefixed address, or null if unresolvable.'
))

story.append(add_subsection('11.7 src/lib/types.ts — Shared Types'))
story.append(para(
    'RuleType union, Rule interface (config is unknown — handles both Postgres Json object and '
    'SQLite JSON string), RequestStatus union, plus RULE_TYPE_LABELS and RULE_TYPE_DESCRIPTIONS '
    'for UI display.'
))

story.append(add_subsection('11.8 src/lib/db.ts — Prisma Client Singleton'))
story.append(para(
    'Prevents multiple Prisma client instances in dev (Next.js hot reloading would otherwise create '
    'one per reload). Uses globalThis to cache the client across hot reloads.'
))

# 11.10 page.tsx
story.append(add_subsection('11.9 src/app/page.tsx — Single-Page Dashboard'))
story.append(para('The main UI. Three tabs + two dialogs:'))
story.append(para('<b>Dashboard tab:</b>', BODY_LEFT))
for item in [
    'Wallet card (address, balance, TESTNET badge, explorer link)',
    'On-chain vault card (per-tx cap, daily cap, spent today, current commit hash + version, SIMULATED badge)',
    'Chat input (Agent role, plain English -> SUI transfer)',
    'Activity feed (live-updating, polls every 4s, color-coded status badges)',
]:
    story.append(Paragraph('• ' + item, BULLET))
story.append(para('<b>Rule book tab:</b>', BODY_LEFT))
for item in [
    'T4 tamper detection banner (red, fires on hash mismatch)',
    'Owner authentication banner (green when authenticated, amber when not)',
    'On-chain rule book commit card (version, full SHA-256 hash, caps, spent today)',
    'Off-chain rule book (list with toggle/delete buttons, "Add rule" dialog)',
]:
    story.append(Paragraph('• ' + item, BULLET))
story.append(para('<b>Architecture tab:</b>', BODY_LEFT))
for item in [
    'Updated ASCII diagram showing the full flow (idempotency, vault, policy, OwnerCap, tamper detection)',
    'Stack list (framework, UI, DB, chain, on-chain, LLM, auth, idempotency, tamper detection)',
    '20-question Q&A section (every hard judge question with a specific implementation answer)',
]:
    story.append(Paragraph('• ' + item, BULLET))
story.append(para('<b>Dialogs:</b>', BODY_LEFT))
for item in [
    'Confirmation dialog (two-step flow): original message + parsed intent side-by-side, amber diff warning, Reject / Confirm & execute buttons',
    'Owner login dialog: password input, demo password hint, OwnerCap pattern explanation',
]:
    story.append(Paragraph('• ' + item, BULLET))

# 11.11 Move module
story.append(add_subsection('11.10 move/veto/sources/vault.move — The On-Chain Vault (Production Target)'))
story.append(para('Key properties:'))
for item in [
    '<b>OwnerCap pattern</b> — possession of the OwnerCap object IS authorization. Sui runtime checks before function runs.',
    '<b>Atomic spend (race-condition safe)</b> — vault::spend() checks daily cap AND increments spent counter in the same Move transaction. Sui\'s shared-object consensus serializes concurrent calls.',
    '<b>Events for off-chain audit</b> — Spent, RulesCommitted, CapsConfigured events emitted on every state change.',
    '<b>Read-only views</b> — per_tx_cap_mist(), daily_cap_mist(), spent_today_mist(), rules_commit_hash(), rules_version() callable by anyone.',
]:
    story.append(Paragraph('• ' + item, BULLET))


# ═══════════════════════════════════════════════════════════════
# Section 12: API Reference
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('12. API Reference'))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Method', 'Path', 'Auth', 'Purpose'],
    ['POST', '/api/agent/message', 'None (Agent)', 'LLM parse -> stage as AWAITING_CONFIRMATION'],
    ['POST', '/api/agent/confirm', 'None (Agent)', 'Idempotency (T5) -> vault -> policy -> SUI execution'],
    ['GET', '/api/requests?limit=20', 'None', 'Activity feed (newest first)'],
    ['GET', '/api/rules', 'None (read)', 'List rules + vault state + commit + tamper flag'],
    ['POST', '/api/rules', 'Owner cookie/token', 'Create rule -> triggers vault re-commit'],
    ['PATCH', '/api/rules/:id', 'Owner cookie/token', 'Toggle/edit -> triggers vault re-commit'],
    ['DELETE', '/api/rules/:id', 'Owner cookie/token', 'Delete -> triggers vault re-commit'],
    ['POST', '/api/owner/login', 'None', 'Verify password -> set signed session cookie'],
    ['POST', '/api/owner/logout', 'None', 'Clear session cookie'],
    ['GET', '/api/owner/status', 'None', 'Returns { authenticated: boolean }'],
    ['GET', '/api/wallet', 'None', 'Read-only wallet info (address, balance, network)'],
    ['GET', '/api/aliases', 'None', 'Known recipient aliases'],
    ['POST', '/api/seed', 'None', 'Seed default rules + initial commit (idempotent)'],
], col_ratios=[0.10, 0.24, 0.20, 0.46]))
story.append(Spacer(1, 8))

story.append(add_subsection('Example: Full Two-Step Flow'))
story.append(code_block("""# Step 1: Send message, get parsed intent + request ID
curl -X POST http://localhost:3000/api/agent/message \\
  -H "Content-Type: application/json" \\
  -d '{"message":"send 1 sui to alice"}'
# Response: { "id":"cmq...", "parsedIntent":{...}, "status":"AWAITING_CONFIRMATION" }

# Step 2: Confirm (or reject)
curl -X POST http://localhost:3000/api/agent/confirm \\
  -H "Content-Type: application/json" \\
  -d '{"id":"cmq...","decision":"confirm"}'
# Response: { "id":"cmq...", "status":"EXECUTED", "txDigest":"..." }
#   or: { "id":"cmq...", "status":"BLOCKED", "failedRule":"..." }"""))


# ═══════════════════════════════════════════════════════════════
# Section 13: Database Schema
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('13. Database Schema'))

story.append(add_subsection('Rule table'))
story.append(make_table([
    ['Column', 'Type', 'Description'],
    ['id', 'String (cuid)', 'Primary key'],
    ['name', 'String', 'Human-readable rule name'],
    ['type', 'String', 'MAX_AMOUNT_PER_TX | DAILY_SPEND_CAP | ALLOWED_RECIPIENT | DENYLIST_ADDRESS'],
    ['config', 'Json (Postgres) / String (SQLite)', 'Rule-specific: {maxAmountSui} | {capSui} | {addresses:[...]}'],
    ['enabled', 'Boolean', 'Whether the rule is active (default: true)'],
    ['createdAt', 'DateTime', 'Creation timestamp'],
    ['updatedAt', 'DateTime', 'Last update timestamp'],
], col_ratios=[0.18, 0.32, 0.50]))
story.append(Spacer(1, 8))

story.append(add_subsection('AgentRequest table'))
story.append(make_table([
    ['Column', 'Type', 'Description'],
    ['id', 'String (cuid)', 'Primary key'],
    ['rawMessage', 'String', 'The original plain-English instruction'],
    ['parsedIntent', 'Json?', 'The LLM-parsed intent (null if parsing failed)'],
    ['amountSui', 'Float?', 'SUI amount (null if not a transfer)'],
    ['recipient', 'String?', 'Resolved Sui address (null if not a transfer)'],
    ['status', 'String', 'PENDING | AWAITING_CONFIRMATION | APPROVED | BLOCKED | EXECUTED | FAILED'],
    ['failedRule', 'String?', 'Rule name if BLOCKED (e.g. Per-transaction cap, on_chain_vault:..., fail_closed_no_rules, idempotency_check, user_rejected)'],
    ['failReason', 'String?', 'Human-readable failure reason'],
    ['txDigest', 'String?', 'Sui transaction digest if EXECUTED'],
    ['confirmedAt', 'DateTime?', 'When user confirmed (null until confirmation step)'],
    ['createdAt', 'DateTime', 'Creation timestamp'],
], col_ratios=[0.18, 0.22, 0.60]))
story.append(Spacer(1, 8))

story.append(add_subsection('RuleBookCommit table'))
story.append(make_table([
    ['Column', 'Type', 'Description'],
    ['id', 'String (cuid)', 'Primary key'],
    ['commitHash', 'String', 'SHA-256 of canonical rule set JSON (0x-prefixed hex)'],
    ['version', 'Int', 'Monotonically increasing version number'],
    ['txDigest', 'String?', 'null in simulator mode; real Sui tx digest once Move is deployed'],
    ['createdAt', 'DateTime', 'Commit timestamp'],
], col_ratios=[0.18, 0.22, 0.60]))


# ═══════════════════════════════════════════════════════════════
# Section 14: Move Module
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('14. The Move Module (Production Target)'))

story.append(para(
    'The Move source at move/veto/sources/vault.move defines a vault that <b>actually holds funds</b> '
    'and enforces hard caps on-chain. Key properties:'
))

story.append(add_subsection('OwnerCap pattern (the "why Sui" argument)'))
story.append(code_block("""public struct OwnerCap has key, store {}

public fun commit_rules(_cap: &OwnerCap, vault: &mut Vault, new_hash: vector<u8>) {
    vault.rules_commit_hash = new_hash;
    vault.rules_version = vault.rules_version + 1;
    event::emit(RulesCommitted { hash: new_hash, version: vault.rules_version });
}"""))
story.append(para(
    'On Sui, the runtime checks object ownership BEFORE the function runs. A tx without the OwnerCap '
    'is rejected at the protocol level — not by app code that could be patched or bypassed.'
))

story.append(add_subsection('Atomic spend (race-condition safe)'))
story.append(code_block("""public fun spend(vault: &mut Vault, coin: Coin<SUI>, recipient: address, amount_mist: u64, ctx: &mut TxContext) {
    assert!(amount_mist > 0, EAmountZero);
    assert!(amount_mist <= vault.per_tx_cap_mist, EAmountExceedsPerTx);

    // Roll daily window if 24h elapsed
    let now_ms = tx_context::timestamp_ms(ctx);
    if (now_ms - vault.window_start_ms >= 24 * 60 * 60 * 1000) {
        vault.spent_today_mist = 0;
        vault.window_start_ms = now_ms;
    };

    // ATOMIC: check + increment in same transaction
    let projected = vault.spent_today_mist + amount_mist;
    assert!(projected <= vault.daily_cap_mist, EAmountExceedsDailyCap);
    vault.spent_today_mist = projected;

    // Split + transfer
    let to_send = coin::split(&mut coin, amount_mist, ctx);
    transfer::public_transfer(to_send, recipient);
    transfer::public_transfer(coin, tx_context::sender(ctx));

    event::emit(Spent { recipient, amount_mist });
}"""))
story.append(para(
    'Sui\'s shared-object consensus serializes concurrent calls to spend(). Two simultaneous spends '
    'CANNOT both pass — one will see the other\'s increment and reject.'
))

story.append(add_subsection('Build & deploy (requires Sui CLI)'))
story.append(code_block("""sui move build --path move/veto
sui client publish --gas-budget 100000000 move/veto

# From the publish output, set these env vars:
# VAULT_OBJECT_ID  - the shared Vault object ID
# VAULT_PACKAGE_ID - the package ID
# OWNER_CAP_ID     - the OwnerCap object ID (transferred to your deployer address)"""))


# ═══════════════════════════════════════════════════════════════
# Section 15: Environment Variables
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('15. Environment Variables'))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Variable', 'Required', 'Description', 'Example'],
    ['DATABASE_URL', 'Yes', 'SQLite (file:) for local dev OR Postgres (postgresql://) for production', 'postgresql://user:pass@host/db?sslmode=require'],
    ['SUI_AGENT_SECRET_KEY', 'Yes', 'Ed25519 private key for the agent\'s testnet wallet', 'suiprivkey1q...'],
    ['SUI_NETWORK', 'Yes', 'Sui network to use', 'testnet'],
    ['OWNER_PASSWORD', 'Yes', 'Password for POST /api/owner/login', 'dev-owner-password'],
    ['OWNER_TOKEN', 'Optional', 'Bearer token for API clients - alternative to cookie', 'dev-owner-token'],
    ['OWNER_COOKIE_SECRET', 'Optional', 'HMAC secret for signing session cookies', 'random-32-byte-hex'],
    ['VAULT_OBJECT_ID', 'Production', 'Shared Vault object ID from sui client publish', '0x...'],
    ['VAULT_PACKAGE_ID', 'Production', 'Package ID from publish', '0x...'],
    ['OWNER_CAP_ID', 'Production', 'OwnerCap object ID - kept server-side only', '0x...'],
], col_ratios=[0.22, 0.12, 0.42, 0.24]))


# ═══════════════════════════════════════════════════════════════
# Section 16: Local Development
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('16. Local Development'))

story.append(add_subsection('First-time setup'))
story.append(code_block("""# 1. Install dependencies
bun install

# 2. Copy env template and edit values
cp .env.example .env
# Edit .env: set SUI_AGENT_SECRET_KEY, OWNER_PASSWORD

# 3. Switch to SQLite schema for local dev
./scripts/switch-db.sh sqlite

# 4. Push schema to local SQLite DB
bun run db:push

# 5. Start dev server
bun run dev"""))
story.append(para('Open http://localhost:3000 — the app auto-seeds three default rules + initial vault commit on first load.'))

story.append(add_subsection('Available scripts'))
story.append(Spacer(1, 4))
story.append(make_table([
    ['Command', 'What it does'],
    ['bun run dev', 'Start Next.js dev server on port 3000'],
    ['bun run lint', 'Run ESLint'],
    ['bun run test', 'Run unit tests (vitest) - 19 tests'],
    ['bun run test:watch', 'Run unit tests in watch mode'],
    ['bun run test:api', 'Run API smoke test (requires dev server running)'],
    ['bun run pre-deploy', 'Run pre-deploy safety check (catches SQLite + missing env vars)'],
    ['bun run db:push', 'Push Prisma schema to DB'],
    ['bun run db:switch-postgres', 'Switch to Postgres schema + push'],
    ['bun run db:switch-sqlite', 'Switch to SQLite schema + push'],
    ['bun run build', 'Production build'],
], col_ratios=[0.32, 0.68]))


# ═══════════════════════════════════════════════════════════════
# Section 17: Testing
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('17. Testing'))

story.append(add_subsection('Unit tests (tests/policy-engine.test.ts)'))
story.append(para(
    '19 tests covering all 4 rule types (boundary conditions, just-over, just-under), multi-rule '
    'behavior (first failure wins, all-pass approves, disabled rules ignored), and the fail-closed '
    'edge case (zero enabled rules -> BLOCKED with fail_closed_no_rules).'
))
story.append(code_block("""bun run test
# Expected: 19 passed, 0 failed"""))

story.append(add_subsection('API smoke test (tests/api-test.sh)'))
story.append(para(
    '10-step curl-based test verifying all 6 threat mitigations end-to-end: T4 (tamper detection), '
    'T5 (idempotency), T6 (auth), on-chain vault block path, and two-step confirmation flow.'
))
story.append(code_block("""# Against localhost
BASE_URL=http://localhost:3000 OWNER_PASSWORD=dev-owner-password bun run test:api
# Expected: 10 passed, 0 failed

# Against deployed Vercel URL
BASE_URL=https://your-app.vercel.app OWNER_PASSWORD=yourpassword bun run test:api"""))

story.append(add_subsection('Manual test checklist (tests/manual-test-checklist.md)'))
story.append(para(
    'Everything that needs a browser or real chain state: Auth (T6) login/logout flow, Tamper '
    'detection (T4) with both SQLite and Postgres mutation commands, OwnerCap enforcement on-chain, '
    'Core flow BLOCKED vs APPROVED vs real tx digest, Idempotency (T5) with funded wallet, '
    'Fail-closed edge case, Deployment verification. SQLite-on-Vercel warning is at the top.'
))


# ═══════════════════════════════════════════════════════════════
# Section 18: Deployment
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('18. Deployment'))

story.append(add_subsection('Before deploying to Vercel: switch to Postgres'))
story.append(para(
    '<b>SQLite does NOT work on Vercel.</b> Serverless functions get a fresh filesystem on every '
    'request — a SQLite file written to disk doesn\'t persist. Your rule book and history will '
    'silently reset in production even though everything works on localhost.'
))
story.append(code_block("""# 1. Create a free Postgres instance at https://neon.tech
# 2. Set DATABASE_URL in .env to the pooled Neon connection string:
#    postgresql://user:pass@host/db?sslmode=require

# 3. Switch the active schema to Postgres + push
./scripts/switch-db.sh postgres
bun run db:push

# 4. Run the pre-deploy check (catches SQLite + missing env vars)
./scripts/pre-deploy-check.sh"""))

story.append(add_subsection('Vercel deployment'))
for i, step in enumerate([
    '<b>Push to GitHub</b> (public repo) — .env and *.db are gitignored',
    '<b>Import on Vercel</b> (Hobby/free tier, no credit card required)',
    '<b>Set environment variables</b> in Vercel: DATABASE_URL (Postgres), SUI_AGENT_SECRET_KEY, OWNER_PASSWORD, SUI_NETWORK=testnet',
    '<b>Deploy</b>',
    '<b>Smoke test the live URL</b>: BASE_URL=https://your-app.vercel.app OWNER_PASSWORD=yourpassword bun run test:api — should be 10/10 PASS',
]):
    story.append(Paragraph(f'{i+1}. {step}', BULLET))

story.append(add_subsection('Fund the agent wallet'))
story.append(para(
    'The agent\'s testnet wallet needs SUI for the EXECUTED flow to actually land on-chain. Get the '
    'agent address from the dashboard, visit https://faucet.testnet.sui.io, request testnet SUI to '
    'that address. If unfunded, the EXECUTED flow still runs through the policy engine and on-chain '
    'vault pre-flight, then returns a meaningful "insufficient balance" error — proving the entire '
    'pipeline works. The BLOCKED flows are completely unaffected (they never touch the chain).'
))


# ═══════════════════════════════════════════════════════════════
# Section 19: Demo Script
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('19. Demo Script (5 minutes)'))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Time', 'Content', 'Criterion targeted'],
    ['0:00-0:30', 'Problem: Agents holding real money, most frameworks let the model decide and execute in one step', 'Real-World Application'],
    ['0:30-1:00', 'Mechanism: deterministic check, not another model\'s opinion, between proposal and signature. Name the Owner/Agent split explicitly', 'Real-World Application'],
    ['1:00-3:00', 'Live demo: (a) send 100 sui to alice -> BLOCKED by on-chain vault, no chain call; (b) send 0.5 sui to self -> EXECUTED, real Explorer link; (c) Edit a rule on /rules -> new on-chain commit hash appears', 'Product & UX + Technical'],
    ['3:00-4:00', 'Tamper detection: open terminal, run sqlite3 UPDATE -> switch back to browser -> red banner fires within 15s', 'Technical Implementation'],
    ['4:00-5:00', 'Why this is honest: real working version of an idea Sui flagged as missing. Roadmap: user-delegated wallets, multi-action, enterprise case', 'Presentation & Vision'],
], col_ratios=[0.12, 0.62, 0.26]))

story.append(add_subsection('Demo scenarios (verified working)'))
story.append(Spacer(1, 4))
story.append(make_table([
    ['Scenario', 'Input', 'Expected outcome'],
    ['Block by on-chain vault', 'send 100 sui to alice', 'BLOCKED - on-chain vault: EAmountExceedsPerTx (100 > 5 SUI per-tx cap)'],
    ['Block by off-chain rule', 'send 1 sui to 0x...0bad', 'BLOCKED - blocked by: Known-bad address blocklist'],
    ['Reject in confirmation', 'send 2 sui to self -> click Reject', 'BLOCKED - rejected by: user rejected'],
    ['Fail-closed', 'Disable all rules -> send 0.1 sui to self', 'BLOCKED - fail_closed_no_rules'],
    ['Successful execution', 'send 0.5 sui to self (funded wallet)', 'EXECUTED - real tx digest + Sui Explorer link'],
], col_ratios=[0.22, 0.33, 0.45]))


# ═══════════════════════════════════════════════════════════════
# Section 20: 20 Hard Questions
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('20. Answers to 20 Hard Judge Questions'))

story.append(para(
    'The Architecture tab in the app contains a complete Q&A section. Here\'s the summary — every '
    'answer maps to a specific implementation decision visible in the code.'
))

qa_items = [
    (1, 'Name 3 AI agents with wallets', 'Truth Terminal, ElizaOS, Coinbase Agentic Wallets — README evidence table'),
    (2, 'Why "deterministic" valuable?', 'Architectural separation: LLM proposes in /api/agent/message, code enforces in /api/agent/confirm — different modules, different auth'),
    (3, 'Which frameworks let LLM decide+execute?', 'LangGraph, ElizaOS, Goose — all execute on model decision. Coinbase AgentKit ships limits but inside their closed stack'),
    (4, 'Why blockchain vs Git commit?', 'Git proves what was committed, not what ran. On-chain commit + spend() tied to commit = provable runtime enforcement'),
    (5, 'Who is the attacker?', 'Three: the agent (prompt injection), compromised dependencies (defeated by on-chain vault), compromised backend operator (defeated by on-chain caps)'),
    (6, 'Owner sets max=1M -> drain?', 'On-chain vault caps regardless. Owner can\'t bypass without vault::configure() (visible event)'),
    (7, 'Why Move/Sui?', 'Shared objects (atomic spend), Move resource safety, sponsored tx, OwnerCap capability pattern (protocol-level auth)'),
    (8, 'Race condition?', 'vault::spend() is atomic — Sui consensus serializes concurrent calls'),
    (9, 'Hallucination prevention?', 'Two-step confirmation dialog with diff warnings. Zod validates schema; user validates semantics'),
    (10, 'Who enforces Owner/Agent?', 'requireOwner() middleware (cookie or token) + on-chain OwnerCap (production)'),
    (11, 'Vercel compromised?', 'On-chain vault is backstop. Compromised evaluateRules() cannot exceed caps'),
    (12, 'Who buys this?', 'Agent framework teams (ElizaOS, ai16z, LangChain) — they build agents, not policy'),
    (13, 'Market size?', '~500-2000 deployment teams today, growing 3x/year (LangChain, Coinbase AgentKit metrics)'),
    (14, 'Competition?', 'AgentKit (closed), Permit.io (off-chain), Arcjet (rate limit), LangGraph HITL (doesn\'t scale). Veto: on-chain enforcement'),
    (15, 'App-custodied = centralized?', 'In v1 yes, but on-chain vault is the security boundary. v1.1 = user-delegated wallets'),
    (16, 'Remove chain, what disappears?', 'Tamper-evidence + race prevention + backend-compromise survival'),
    (17, 'OpenAI adds max_spend -> startup dies?', 'What survives: open, framework-agnostic, multi-chain, on-chain enforcement'),
    (18, 'Why install Veto vs if(amount > limit)?', 'Your code can be edited by anyone. The on-chain vault cannot.'),
    (19, 'Neon goes down?', 'App fails gracefully. No funds at risk (chain vault still enforces). Fail-closed design.'),
    (20, 'Why rank above team with zkLogin but no on-chain commit?', 'Their limits are claims, ours are proofs. For Sui specifically, "verifiable policy enforcement" is exactly what Sui said is missing'),
]

qa_data = [['#', 'Question', 'Answer (implementation)']]
for n, q, a in qa_items:
    qa_data.append([str(n), q, a])
story.append(Spacer(1, 6))
story.append(make_table(qa_data, col_ratios=[0.05, 0.30, 0.65]))


# ═══════════════════════════════════════════════════════════════
# Section 21: Who Buys This
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('21. Who Buys This — Three Concrete Buyers'))

buyers = [
    ('DAOs and treasury teams',
     'Delegating limited authority to an agent for routine ops (recurring payments, rebalancing, yield farming). They need enforceable, provable limits before a governance vote will approve delegating anything real. The on-chain vault + tamper-evident rule commit is exactly the audit trail their governance committee asks for.'),
    ('Agent framework providers (ElizaOS, ai16z, LangChain, CrewAI)',
     'Distribution path: bundle Veto\'s policy layer as a default safety module inside an agent SDK, the way payment processors bundle fraud checks rather than making every merchant build their own. Coinbase already shipped this internally as part of AgentKit — Veto is the open, framework-agnostic version.'),
    ('Custodians and regulated entities piloting agentic execution',
     'Compliance teams need an auditable control layer, and "capability-enforced, on-chain-verifiable policy" is language they can actually evaluate — unlike "we trust the model." The enterprise wedge: regulated capital can\'t move via an AI agent without a provable policy layer between the agent and the wallet.'),
]
for name, desc in buyers:
    story.append(Paragraph(f'<b>{name}</b>', H3))
    story.append(para(desc))

story.append(add_subsection('Monetization (stated plainly, not oversold)'))
story.append(para(
    'Open-source the policy engine for adoption and trust. Charge for a hosted multi-agent dashboard '
    'and compliance export (CSV/PDF audit reports tied to on-chain commit hashes). Standard open-core, '
    'easy for a judge to believe.'
))


# ═══════════════════════════════════════════════════════════════
# Section 22: Roadmap
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('22. Roadmap'))

roadmap = [
    ('v1.1 — Delegated user wallets via dapp-kit + sponsored transactions',
     'Let users connect their own Sui wallet and delegate a spending-limited sub-key to the agent. The on-chain vault stays the same.'),
    ('v1.2 — Multiple action types',
     'Beyond transfers — Navi deposits, DeepBook trades, NFT mints — each with its own rule types and vault spend paths.'),
    ('v2.0 — Multi-agent',
     'Multiple agents with separate sub-vaults under one Owner, each with its own caps and rule book commits.'),
    ('Long-term',
     'Regulated entities (custodians, treasuries, DAOs) that need provable guardrails before they\'ll let any AI agent near real funds.'),
]
for name, desc in roadmap:
    story.append(Paragraph(f'<b>{name}</b>', H3))
    story.append(para(desc))


# ═══════════════════════════════════════════════════════════════
# Section 23: Failure Modes
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('23. Failure Modes & Operational Notes'))

story.append(add_subsection('Neon (Postgres) goes down'))
story.append(para(
    'App fails gracefully — no requests can be approved or blocked because the off-chain engine '
    'can\'t load rules. No funds at risk — the chain vault still enforces its cap (vault state is '
    'on-chain, not in Neon). Recovery: bring Neon back up, app resumes. Agent requests during the '
    'outage are queued by the user (no auto-retry). This is a <b>fail-closed</b> design, not fail-open.'
))

story.append(add_subsection('Sui testnet RPC issues'))
story.append(para(
    'Wallet balance reads may fail — UI shows "Loading wallet..." indefinitely. Transfer execution '
    'may fail — AgentRequest gets status=FAILED with the Sui error message. BLOCKED flows are '
    'unaffected (they never touch the chain).'
))

story.append(add_subsection('Faucet rate-limited'))
story.append(para(
    'Agent wallet stays at 0 SUI. EXECUTED flow returns "insufficient balance" error. All BLOCKED '
    'flows still work perfectly (they never touch the chain). Fix: fund the wallet from a clean IP, '
    'or use a different faucet.'
))

story.append(add_subsection('Owner forgets password'))
story.append(para(
    'Cannot edit rules until password is reset. Agent can still propose actions (and they\'ll be '
    'evaluated against the existing rule book). Fix: set a new OWNER_PASSWORD env var, restart the server.'
))

story.append(add_subsection('Move module deployment fails'))
story.append(para(
    'The off-chain simulator continues to work (v1 mode). The UI shows "SIMULATED" badge — judges '
    'know the on-chain deployment is pending. Fix: deploy the Move module when Sui CLI is available, '
    'set VAULT_OBJECT_ID / VAULT_PACKAGE_ID / OWNER_CAP_ID env vars.'
))


# ═══════════════════════════════════════════════════════════════
# Closing
# ═══════════════════════════════════════════════════════════════
story.append(Spacer(1, 24))
story.append(HRFlowable(width='100%', thickness=0.6, color=BORDER,
                        spaceBefore=8, spaceAfter=8))
story.append(Paragraph(
    '<i>Built for Sui Overflow 2026 — Agentic Web track. Sui\'s own current ecosystem messaging '
    'explicitly frames agent guardrails and verifiable policy enforcement as missing infrastructure. '
    'Veto is a focused, single-mechanism answer to exactly that problem — built on Sui\'s primitives '
    '(shared objects, Move resources, atomic spend, OwnerCap capability pattern) that no other chain '
    'replicates.</i>',
    ParagraphStyle('closing', fontName='FreeSerif-Italic', fontSize=9, leading=13,
                   textColor=TEXT_MUTED, alignment=TA_CENTER)))


# ───────────────────────── BUILD ─────────────────────────
out_path = '/home/z/my-project/research/veto_docs_body.pdf'
doc = TocDocTemplate(
    out_path,
    pagesize=A4,
    leftMargin=1.0 * inch,
    rightMargin=1.0 * inch,
    topMargin=0.85 * inch,
    bottomMargin=0.75 * inch,
    title='Veto — Complete Project Documentation',
    author='Z.ai',
    creator='Z.ai',
    subject='Veto: deterministic, verifiable policy gate for AI agents on Sui',
)
doc.multiBuild(story, onFirstPage=add_page_decoration, onLaterPages=add_page_decoration)
print(f'Body PDF generated: {out_path}')
