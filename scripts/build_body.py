#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Sui Overflow 2026 — Builder Tactical Playbook (body PDF generator).
Uses ReportLab. Cover is generated separately via html2poster.js and merged.
"""
import os
import sys
import hashlib
from datetime import datetime

# Skill path
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
    Image, KeepTogether, CondPageBreak, HRFlowable, Flowable
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

# ───────────────────────── PALETTE (cascade, seed=42) ─────────────────────────
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
SEM_INFO      = colors.HexColor('#4b6c8d')

TABLE_HEADER_COLOR = HEADER_FILL
TABLE_HEADER_TEXT  = colors.white
TABLE_ROW_EVEN     = colors.white
TABLE_ROW_ODD      = TABLE_STRIPE

# ───────────────────────── STYLES ─────────────────────────
ss = getSampleStyleSheet()

H1 = ParagraphStyle(name='H1', fontName='FreeSerif-Bold', fontSize=20, leading=26,
                    textColor=HEADER_FILL, spaceBefore=18, spaceAfter=10, alignment=TA_LEFT)
H2 = ParagraphStyle(name='H2', fontName='FreeSerif-Bold', fontSize=14, leading=20,
                    textColor=ACCENT, spaceBefore=14, spaceAfter=8, alignment=TA_LEFT)
H3 = ParagraphStyle(name='H3', fontName='FreeSerif-Bold', fontSize=11.5, leading=16,
                    textColor=HEADER_FILL, spaceBefore=10, spaceAfter=5, alignment=TA_LEFT)
BODY = ParagraphStyle(name='Body', fontName='FreeSerif', fontSize=10.5, leading=16,
                      textColor=TEXT_PRIMARY, alignment=TA_JUSTIFY, spaceAfter=8,
                      firstLineIndent=0)
BODY_NOINDENT = ParagraphStyle(name='BodyNoIndent', parent=BODY, alignment=TA_LEFT)
BULLET = ParagraphStyle(name='Bullet', parent=BODY, leftIndent=18, bulletIndent=4,
                        spaceAfter=4, alignment=TA_LEFT)
QUOTE = ParagraphStyle(name='Quote', fontName='FreeSerif-Italic', fontSize=10.5, leading=16,
                       textColor=TEXT_MUTED, leftIndent=24, rightIndent=24, spaceBefore=8,
                       spaceAfter=12, alignment=TA_LEFT, borderColor=ACCENT, borderWidth=0)
META = ParagraphStyle(name='Meta', fontName='FreeSerif', fontSize=8.5, leading=12,
                      textColor=TEXT_MUTED, alignment=TA_LEFT)
CALLOUT = ParagraphStyle(name='Callout', fontName='FreeSerif-Bold', fontSize=11, leading=16,
                         textColor=ACCENT, alignment=TA_LEFT, leftIndent=12, rightIndent=12,
                         spaceBefore=6, spaceAfter=6)
TBL_HDR = ParagraphStyle(name='TblHdr', fontName='FreeSerif-Bold', fontSize=9.5, leading=12,
                         textColor=colors.white, alignment=TA_CENTER)
TBL_CELL = ParagraphStyle(name='TblCell', fontName='FreeSerif', fontSize=9, leading=12,
                          textColor=TEXT_PRIMARY, alignment=TA_LEFT)
TBL_CELL_C = ParagraphStyle(name='TblCellC', parent=TBL_CELL, alignment=TA_CENTER)
TBL_CELL_BOLD = ParagraphStyle(name='TblCellBold', parent=TBL_CELL, fontName='FreeSerif-Bold')

TOC_L0 = ParagraphStyle(name='TOC0', fontName='FreeSerif-Bold', fontSize=12, leading=20,
                        leftIndent=0, textColor=HEADER_FILL)
TOC_L1 = ParagraphStyle(name='TOC1', fontName='FreeSerif', fontSize=10.5, leading=16,
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


def add_major_section(text, style):
    return [
        CondPageBreak(120),
        add_heading(text, style, level=0),
    ]


def add_subsection(text, style=H3):
    return add_heading(text, style, level=1)


def para(text, style=BODY):
    return Paragraph(text, style)


def bullet_list(items, style=BULLET):
    return [Paragraph('• ' + t, style) for t in items]


def hr_thin():
    return HRFlowable(width='100%', thickness=0.4, color=BORDER,
                      spaceBefore=6, spaceAfter=6, lineCap='round')


def stat_block(stats):
    """stats: list of (number, label) tuples — render as a 4-col card row."""
    cells = []
    for num, label in stats:
        cells.append([
            Paragraph(f'<font color="#2b6886" size="20"><b>{num}</b></font>',
                      ParagraphStyle('statn', fontName='FreeSerif-Bold', fontSize=20,
                                     leading=24, alignment=TA_CENTER, textColor=ACCENT)),
            Paragraph(label, ParagraphStyle('statl', fontName='FreeSerif', fontSize=8.5,
                                            leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED))
        ])
    # Build a row table with one column per stat
    n = len(stats)
    avail = A4[0] - 2 * inch  # 1-inch margins
    col_w = avail / n
    row1 = [c[0] for c in cells]
    row2 = [c[1] for c in cells]
    tbl = Table([row1, row2], colWidths=[col_w] * n, hAlign='CENTER')
    tbl.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), CARD_BG),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('TOPPADDING', (0, 0), (-1, 0), 12),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 2),
        ('TOPPADDING', (0, 1), (-1, 1), 2),
        ('BOTTOMPADDING', (0, 1), (-1, 1), 12),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('BOX', (0, 0), (-1, -1), 0.5, BORDER),
        ('LINEBEFORE', (1, 0), (1, -1), 0.5, BORDER),
        ('LINEBEFORE', (2, 0), (2, -1), 0.5, BORDER) if n >= 3 else ('BOX', (0, 0), (-1, -1), 0.5, BORDER),
        ('LINEBEFORE', (3, 0), (3, -1), 0.5, BORDER) if n >= 4 else (),
    ]))
    return tbl


def make_table(data_rows, col_ratios=None, header=True, hAlign='CENTER'):
    """Build a standard styled table.
    data_rows: list of lists of strings (will be wrapped in Paragraph)
    """
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
                wrow.append(Paragraph(cell, TBL_CELL))
        wrapped.append(wrow)

    tbl = Table(wrapped, colWidths=col_widths, hAlign=hAlign, repeatRows=1 if header else 0)
    style = [
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 7),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
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


def callout_box(title, body_text, color=ACCENT):
    """A colored sidebar callout."""
    t = Table([[Paragraph(f'<b>{title}</b>', ParagraphStyle('cot', fontName='FreeSerif-Bold',
                                                              fontSize=10.5, leading=14,
                                                              textColor=colors.white, alignment=TA_LEFT))],
               [Paragraph(body_text, ParagraphStyle('cob', fontName='FreeSerif', fontSize=9.5,
                                                     leading=14, textColor=TEXT_PRIMARY,
                                                     alignment=TA_LEFT))]],
              colWidths=[A4[0] - 2 * inch - 12], hAlign='CENTER')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (0, 0), color),
        ('BACKGROUND', (0, 1), (0, 1), CARD_BG),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('LINEBELOW', (0, 0), (0, 0), 0.3, BORDER),
        ('BOX', (0, 0), (-1, -1), 0.4, BORDER),
    ]))
    return t


# ───────────────────────── PAGE FOOTER ─────────────────────────
def add_page_decoration(canvas, doc):
    canvas.saveState()
    page_num = doc.page
    # Footer line
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.3)
    canvas.line(inch, 0.6 * inch, A4[0] - inch, 0.6 * inch)
    # Footer text
    canvas.setFont('FreeSerif', 8)
    canvas.setFillColor(TEXT_MUTED)
    canvas.drawString(inch, 0.42 * inch,
                      'Sui Overflow 2026 — Builder Tactical Playbook')
    canvas.drawRightString(A4[0] - inch, 0.42 * inch, f'Page {page_num}')
    # Top accent strip
    canvas.setFillColor(ACCENT)
    canvas.rect(0, A4[1] - 6, A4[0], 6, fill=1, stroke=0)
    canvas.restoreState()


# ───────────────────────── BUILD STORY ─────────────────────────
story = []

# ─── Table of Contents ───
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
# CHAPTER 1 — EXECUTIVE SUMMARY
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 1 — Executive Summary: The 24-Hour Window', H1))

story.append(para(
    'You are reading this with roughly twenty-four hours remaining before the Sui Overflow 2026 '
    'submission deadline of June 21, 6:00 PM Pacific Time (June 22, 6:30 AM India Standard Time). '
    'This document is not a generic hackathon overview. It is a tactical playbook designed for a single '
    'outcome: shipping a project that materially increases your probability of winning a prize in one '
    'of the four official tracks. Every chapter that follows is calibrated to a one-person, AI-assisted, '
    'twenty-four-hour build window. Strategies that would normally require a multi-day team build are '
    'explicitly cut. Recommendations favor leverage over scope.'
))

story.append(para(
    'The Sui Overflow hackathon is the second-largest annual developer event in the Sui ecosystem. '
    'In 2025 it drew 599 submissions across 85 countries and awarded 36 main-track winners plus 10 '
    'university winners out of an approximately one-million-dollar prize pool. The 2026 edition raises '
    'the stakes further: four primary tracks each pay a top prize between $30,000 and $35,000, with a '
    'further $250,000+ in post-hackathon value available through audit credits, ecosystem support, '
    'mentorship, and accelerator introductions. The competition is real, but so is the opportunity: '
    'a well-targeted, polished single-feature project shipped by a solo builder can absolutely place.'
))

# Stat block
story.append(Spacer(1, 10))
story.append(stat_block([
    ('$1M+', 'Total prize pool'),
    ('599', 'Submissions in 2025'),
    ('36', 'Winners in 2025 (≈6%)'),
    ('50%', 'Judging weight: Real-World Application'),
]))
story.append(Spacer(1, 14))

story.append(add_subsection('1.1 The Core Recommendation in One Paragraph'))
story.append(para(
    'Build for the <b>Walrus track</b> and ship a project called <b>AgentVault</b> (working name): an '
    'AI agent with persistent on-chain memory stored on Walrus via the MemWal SDK, executing gasless '
    'Sui transactions on behalf of the user through sponsored transactions, with Web2-style Google '
    'login powered by zkLogin. This project is recommended because it satisfies four track-winning '
    'patterns observed in 2025 winners: (1) it composes three or more Sui primitives — Walrus, MemWal, '
    'zkLogin, sponsored transactions — which judges explicitly reward; (2) it can be built end-to-end '
    'in twenty-four hours using the MemWal sample app as a starting point; (3) it occupies the '
    '"AI-native + verifiable data" narrative that the Walrus track problem statement explicitly '
    'requests; and (4) it carries a strong, simple demo story for the five-minute Demo Day presentation.'
))

story.append(add_subsection('1.2 The Three Things That Must Not Fail'))
story.append(para(
    'In a one-day build, failure modes multiply. Three commitments are non-negotiable. '
    '<b>First</b>, the project must be deployed to Sui testnet before submission — the rules state '
    'plainly that projects must be on testnet or mainnet at the time of shortlisting and Demo Day, '
    'and judges will check the package ID. <b>Second</b>, a five-minute demo video must be recorded '
    'and uploaded to YouTube (unlisted is fine) — this is a hard submission requirement and is often '
    'the single artifact judges use to compare projects. <b>Third</b>, the public GitHub repository '
    'must contain a clear README with a one-paragraph problem statement, an architecture diagram, '
    'setup instructions, and a screenshot. Projects that ship these three things beat projects with '
    'more code but weaker presentation, every time.'
))

story.append(add_subsection('1.3 What This Playbook Will Save You From'))
story.append(para(
    'The most common 24-hour hackathon failure is not running out of time — it is building the wrong '
    'thing. Builders spend sixteen hours implementing a clever Move contract, then realize at hour '
    'twenty that the frontend does not work, the demo video is rushed, the deployment fails, and the '
    'submission is incomplete. This playbook front-loads all strategic decisions: track selection, '
    'project scope, architecture, hour-by-hour schedule, and submission checklist. By the end of '
    'Chapter 9, you will have a concrete build plan. By the end of Chapter 10, you will have a '
    'submission protocol. Everything between is intelligence that sharpens your execution.'
))


# ═══════════════════════════════════════════════════════════════
# CHAPTER 2 — HACKATHON SNAPSHOT
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 2 — Hackathon Snapshot: Timeline, Prize Pool, Stakes', H1))

story.append(para(
    'Sui Overflow 2026 runs from May 7, 2026 to August 27, 2026 — a nearly four-month arc that '
    'compressed into five distinct phases: official launch, building period, submission deadline, '
    'shortlisting, and Demo Day, culminating in the winners announcement. The full timeline is shown '
    'in Figure 1. The "last 24 hours" window shaded on the chart is the operating environment for '
    'this playbook. Everything before it is foregone opportunity; everything after it is downstream '
    'of the choices you make in the next twenty-four hours.'
))

# Insert timeline image
story.append(Spacer(1, 6))
timeline_img = Image('/home/z/my-project/research/timeline.png', width=6.7 * inch, height=3.15 * inch)
timeline_img.hAlign = 'CENTER'
story.append(timeline_img)
story.append(Paragraph('<i>Figure 1. Sui Overflow 2026 timeline with all five phases. The red window marks the final 24-hour submission window.</i>',
                       ParagraphStyle('caption', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))

story.append(add_subsection('2.1 The Five Phases Decoded'))
story.append(para(
    '<b>Phase 1 — Launch (May 7):</b> The hackathon opens during Sui Live in Miami with track '
    'reveals and the prize pool announcement. You are well past this point. <b>Phase 2 — Building '
    '(May 7 to June 21):</b> The active construction window. The official handbook permits both '
    'new projects and substantial extensions of existing projects, provided the new functionality '
    'ships during this window. <b>Phase 3 — Submission Deadline (June 21, 6:00 PM Pacific):</b> The '
    'hard cutoff. After this moment, you may continue updating your repo, but those changes will '
    'not be considered during shortlisting. <b>Phase 4 — Shortlisting & Demo Day (July 8 to July 21):</b> '
    'Shortlisted teams are announced July 8 and present live virtually on July 20–21. <b>Phase 5 — '
    'Winners (August 27):</b> Final winners are announced and may be invited to pitch at Sui Basecamp '
    '2026. Top teams enter the post-hackathon Builder Journey pipeline.'
))

story.append(add_subsection('2.2 Timezone Math You Cannot Afford to Get Wrong'))
story.append(para(
    'The submission deadline is June 21 at 6:00 PM Pacific Time. Converting to India Standard Time '
    '(IST, UTC+5:30), the deadline is June 22 at 6:30 AM IST. Pacific Daylight Time (PDT) is UTC−7, '
    'so IST is 12.5 hours ahead. If you are working in IST, your effective build window ends at first '
    'light on June 22. Plan your sleep schedule accordingly: the worst possible outcome is to be '
    'asleep when the deadline passes. The best practice is to submit no later than 4:00 AM IST on '
    'June 22 (3:00 PM PDT on June 21) to leave a three-hour buffer for any DeepSurge portal issues, '
    'YouTube upload processing time, or testnet RPC congestion.'
))

story.append(add_subsection('2.3 The Prize Pool at a Glance'))
story.append(para(
    'The 2026 prize structure follows a split-distribution model: 50% of any prize is paid upon '
    'winner announcement on August 27, and the remaining 50% is paid after successful mainnet '
    'deployment. Teams that have already deployed to mainnet by the announcement receive 100% '
    'upfront. This split is not a footnote — it is a strategic lever. A team that plans for '
    'mainnet deployment from day one can claim the full prize; a team that treats mainnet as a '
    'future problem forfeits half the nominal prize value. Chapter 11 covers the post-hackathon '
    'mainnet path in detail.'
))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Track', '1st Prize', '2nd Prize', '3rd Prize', '4th Prize'],
    ['Agentic Web', '$30,000', '$15,000', '$10,000', '$7,500'],
    ['DeFi & Payments', '$30,000', '$15,000', '$10,000', '$7,500'],
    ['Walrus', '$35,000', '$15,000', '$7,500', '$5,000'],
    ['DeepBook', '$35,000', '$15,000', '$7,500', '$5,000'],
    ['University Award', '$2,500 ×10 winners', '—', '—', '—'],
], col_ratios=[0.24, 0.19, 0.19, 0.19, 0.19]))
story.append(Paragraph('<i>Table 1. Prize structure across all four tracks plus the University Award. The Walrus and DeepBook tracks offer the largest first-place prizes at $35,000 each.</i>',
                       ParagraphStyle('caption2', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))

story.append(para(
    'Beyond cash prizes, the official handbook lists $250,000+ in additional post-hackathon value: '
    'audit credits (likely from OtterSec and OpenZeppelin, both of which run office hours during the '
    'build period), ecosystem support, mentorship, accelerator introductions, and pitch-deck '
    'breakdown sessions. These resources are the bridge from "hackathon winner" to "venture-backed '
    'startup," and several 2023 Sui hackathon winners — Scallop, NAVI, Bucket, Typus — are now '
    'live protocols with significant TVL.'
))


# ═══════════════════════════════════════════════════════════════
# CHAPTER 3 — THE FOUR TRACKS
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 3 — The Four Tracks: Strategic Comparison', H1))

story.append(para(
    'Sui Overflow 2026 has two core tracks (Agentic Web, DeFi & Payments) and two specialized '
    'tracks (Walrus, DeepBook). All four pay top prizes of $30,000 or $35,000, and all four are '
    'eligible for the post-hackathon $250,000+ value pool. From a one-day-builder perspective, '
    'however, the four tracks are not equally tractable. Each track has a different complexity '
    'ceiling, a different competitive density, and a different degree of fit with AI-assisted '
    'rapid development. This chapter compares them head-to-head.'
))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Track', 'Top Prize', 'Build Difficulty (24h)', 'Competition Density', 'Recommended Fit'],
    ['Agentic Web', '$30,000', 'Medium-High', 'High (trendiest track)', 'Strong if you have an LLM workflow ready'],
    ['DeFi & Payments', '$30,000', 'High', 'Very High (DeFi is the most crowded)', 'Avoid for 24h solo build'],
    ['Walrus', '$35,000', 'Medium', 'Medium', 'Best fit: SDK + samples + clear narrative'],
    ['DeepBook', '$35,000', 'High', 'Medium', 'Strong if you have trading/DeFi background'],
], col_ratios=[0.16, 0.13, 0.21, 0.24, 0.26]))
story.append(Paragraph('<i>Table 2. Strategic comparison of the four tracks from a 24-hour solo-builder perspective.</i>',
                       ParagraphStyle('caption3', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))

story.append(add_subsection('3.1 Agentic Web — The Trendy Track'))
story.append(para(
    'The Agentic Web track problem statement asks for "AI-native agents and autonomous workflows '
    'that deeply leverage Sui primitives to create more powerful, secure, and composable systems '
    'beyond simple integrations." This is the trendiest track in the entire hackathon — AI agents '
    'are the dominant narrative across Web3 in 2026, and this track will receive the most '
    'submissions. The 2025 AI track had four winners (Suithetic, OpenGraph, RaidenX, Hyvve) and '
    'the 2026 Agentic Web track is functionally an evolution of that. The risk here is that you '
    'will be competing against teams that have been building agent infrastructure for months. The '
    'opportunity is that judges love AI agent projects and the bar for "meaningful Sui integration" '
    'is interpretable.'
))

story.append(add_subsection('3.2 DeFi & Payments — The Crowded Track'))
story.append(para(
    'The DeFi & Payments track asks for "programmable payment systems and financial applications '
    'on Sui that move, manage, and transform money intelligently." This is the most competitive '
    'track in any Sui hackathon because the Sui ecosystem is heavily DeFi-weighted: Scallop, NAVI, '
    'Bucket, Typus, Haedal, and dozens of other live protocols all started as hackathon projects. '
    'In 2025, the DeFi track winners (Magma Finance, Pismo Protocol, MizuPay, Kamo Finance) all '
    'shipped substantial multi-component architectures with novel economic mechanisms — these are '
    'not 24-hour builds. <b>Recommendation: avoid this track for a one-day solo build.</b> The bar '
    'is too high and the competitive density is too great.'
))

story.append(add_subsection('3.3 Walrus — The Optimal Track for a 24-Hour Build'))
story.append(para(
    'The Walrus track asks for "AI agents and agentic workflows powered by Walrus as a verifiable '
    'data and memory layer." This is the recommended track for this playbook. Three factors drive '
    'the recommendation. <b>First, leverage</b>: the MemWal SDK ships with sample applications and '
    'a hosted playground where you can create a delegate key for your agent in five minutes — this '
    'eliminates the most painful cold-start work. <b>Second, prize asymmetry</b>: the Walrus track '
    'top prize is $35,000, higher than the $30,000 Agentic Web top prize, despite attracting fewer '
    'submissions. <b>Third, narrative alignment</b>: the track problem statement explicitly invites '
    'AI agent + verifiable data projects, which is precisely the AgentVault concept. The 2025 '
    'Programmable Storage track (the spiritual predecessor of the 2026 Walrus track) produced '
    'SuiSign, WalGraph, SuiMail, and Walpress — all of which are single-feature, well-executed '
    'products that a solo builder could plausibly ship in a day with AI assistance.'
))

story.append(add_subsection('3.4 DeepBook — The High-Prize, High-Difficulty Track'))
story.append(para(
    'The DeepBook track pays $35,000 for first place and asks for "functional applications, '
    'services, vaults, bots, or analytics" built on the DeepBook protocol, including DeepBook '
    'Predict (a binary prediction market protocol on Sui). DeepBook is genuinely interesting and '
    'the prize is the largest, but the difficulty ceiling is high: you need to understand order '
    'book mechanics, the DeepBook v3 architecture, the DeepBook Predict binary-position model, '
    'and the balance manager integration pattern. If you already have trading or DeFi experience, '
    'a DeepBook trading bot or analytics dashboard is viable in 24 hours. If you do not, the '
    'Walrus track is a better fit. Chapter 7 introduces PredictPilot as a backup project idea if '
    'you prefer DeepBook.'
))

story.append(callout_box(
    'VERDICT',
    'For a 24-hour solo AI-assisted build, <b>build for the Walrus track</b>. The MemWal SDK + '
    'sample apps give you a head start no other track can match, the $35,000 top prize is the '
    'joint-highest in the hackathon, and the track problem statement explicitly invites the '
    'AI-agent-plus-verifiable-data pattern that is most achievable in one day. Submit under the '
    'Walrus track as your primary track. If your project also fits Agentic Web, you may note that '
    'in your submission narrative, but you can only submit under one primary track.',
    color=ACCENT
))


# ═══════════════════════════════════════════════════════════════
# CHAPTER 4 — INTELLIGENCE REPORT
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 4 — Intelligence Report: Past Sui & Web3 Hackathon Winners', H1))

story.append(para(
    'The single most useful question a hackathon builder can ask is not "what should I build?" but '
    '"what has won, and why?" This chapter catalogs the projects that have actually won Sui and '
    'comparable Web3 hackathons over the past three years, then distills seven patterns that '
    'separate winners from also-rans. The data comes from the official Sui Foundation winner '
    'announcements, ETHGlobal showcases, the Solana AI Hackathon, the Colosseum Solana Agent '
    'Hackathon, and the Coinbase Onchain AI Hackathon. Where exact prize amounts are public, they '
    'are included.'
))

story.append(add_subsection('4.1 Sui Overflow 2025 Winners — Full Catalog'))
story.append(para(
    'Sui Overflow 2025 attracted 599 submissions from 85 countries and awarded 36 main-track '
    'winners across nine tracks, plus 10 university winners. The table below lists every main-track '
    'winner with the Sui primitives each project used and the inferred reason for the win. This '
    'is the most important intelligence in the entire playbook: these are the projects that the '
    '2026 judges will be mentally comparing your submission against.'
))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Track', 'Project', 'What They Built', 'Primitives Used'],
    ['AI (1st)', 'Suithetic', 'LLM-generated synthetic data, stored onchain, marketplace', 'Sui + Walrus + LLM'],
    ['AI (2nd)', 'OpenGraph', 'Decentralized ML model deploy on Sui + Walrus', 'Sui + Walrus'],
    ['AI (3rd)', 'RaidenX', 'DeFAI data layer for AI trading apps', 'Sui + DeepBook'],
    ['AI (4th)', 'Hyvve', 'Token-incentivized AI training data marketplace', 'Sui + tokens'],
    ['Cryptography (1st)', 'ZeroLeaks', 'ZK whistleblowing platform, end-to-end encrypted', 'Seal + Walrus + ZK'],
    ['Cryptography (2nd)', 'Shroud', 'Privacy-first trading via ZK confidential swaps', 'ZK + DEX'],
    ['Cryptography (3rd)', 'Sui Sentinel', 'AI-vs-AI battle platform, defender agents protect tokens', 'Nautilus + AWS + SUI'],
    ['Cryptography (4th)', 'Sui Shadow', 'Confidential art marketplace, Seal + zkLogin reveal', 'Seal + zkLogin'],
    ['DeFi (1st)', 'Magma Finance', 'Programmable yield abstraction, AI rebalancing, modular vaults', 'Sui + Move + AI'],
    ['DeFi (2nd)', 'Pismo Protocol', 'Composable perpetuals exchange, unified account model', 'Sui + Move'],
    ['DeFi (3rd)', 'MizuPay', 'Mint mzUSD with LBTC, stake for yield, USDC payouts', 'Sui + BTC + Stablecoin'],
    ['DeFi (4th)', 'Kamo Finance', 'Permissionless yield-trading, yield tokenization, ve(3,3)', 'Sui + Move'],
    ['Degen (1st)', 'MoonBags', 'Token launchpad sharing fees during bonding curve', 'Sui + tokens'],
    ['Degen (2nd)', 'Kensei', 'Social/governance layer with AI agents, multichain staking', 'Sui + Wormhole + AI'],
    ['Degen (3rd)', 'MFC.CLUB', 'Gamified meme coin launchpad', 'Sui + tokens'],
    ['Degen (4th)', 'Objection! AI', 'Ace-Attorney courtroom game, human-vs-AI, SUI staking', 'Sui + AI + game'],
], col_ratios=[0.18, 0.16, 0.42, 0.24]))
story.append(Spacer(1, 6))
story.append(make_table([
    ['Track', 'Project', 'What They Built', 'Primitives Used'],
    ['Entertainment (1st)', 'GiveRep', 'Social reputation on X, gamified engagement, AI + blockchain', 'Sui + AI + X API'],
    ['Entertainment (2nd)', 'SWION', 'Onchain activity as underwater garden visual metaphor', 'Sui + visualization'],
    ['Entertainment (3rd)', 'Exclusuive', 'Modular NFT customization via Sui Kiosk, layered interactions', 'Sui + Kiosk'],
    ['Entertainment (4th)', 'Numeron', 'First fully onchain AI-powered RPG on Sui', 'Sui + Dubhe + AI'],
    ['Explorations (1st)', 'Suibotics', 'Physical machine-to-machine coordination, custom hardware', 'Sui + AI + hardware'],
    ['Explorations (2nd)', 'Skepsis', 'Decentralized prediction market, staking on probabilistic outcomes', 'Sui + prediction'],
    ['Explorations (3rd)', 'PactDa', 'Smart contract agreement platform, zkLogin onboarding, SUI escrow', 'Sui + zkLogin + Wormhole'],
    ['Explorations (4th)', 'PredictPlay', 'Gamified entertainment prediction market, AMM pricing', 'Sui + AMM'],
    ['Infra (1st)', 'SuiSQL', 'Decentralized SQL library on Sui + Walrus, indexes/joins/filters', 'Sui + Walrus + SQL'],
    ['Infra (2nd)', 'Sui Provenance Suite', 'Full-stack toolkit for verifiable code deployment', 'Sui + crypto'],
    ['Infra (3rd)', 'Suipulse', 'High-performance data streaming, sub-second latency', 'Sui + streaming'],
    ['Infra (4th)', 'Noodles.Fi', 'Deep analytics + single-click strategies on Sui', 'Sui + analytics'],
    ['Payments (1st)', 'PIVY', 'Stealth address self-custodial payment toolkit, payment links', 'Sui + stealth addr'],
    ['Payments (2nd)', 'Sui Multisig', 'CLI-first multisig wallet manager with lightweight UI', 'Sui + multisig'],
    ['Payments (3rd)', 'SeaWallet', 'Programmable smart contract wallet on Slush, inheritance', 'Sui + Slush'],
    ['Payments (4th)', 'Coindrip', 'Programmable token streams, linear/cliff/custom', 'Sui + streaming'],
    ['Programmable Storage (1st)', 'SuiSign', 'Decentralized document signing on Sui + Walrus', 'Sui + Walrus'],
    ['Programmable Storage (2nd)', 'WalGraph', 'First decentralized graph database on Sui, JSON-LD', 'Sui + Walrus + JSON-LD'],
    ['Programmable Storage (3rd)', 'SuiMail', 'Wallet-native decentralized email, pay-to-send model', 'Sui + Walrus'],
    ['Programmable Storage (4th)', 'Walpress', 'Decentralized site builder on Walrus, SuiNS integration', 'Sui + Walrus + SuiNS'],
], col_ratios=[0.22, 0.16, 0.40, 0.22]))
story.append(Paragraph('<i>Table 3. Complete catalog of Sui Overflow 2025 main-track winners (36 projects across 9 tracks). Source: blog.sui.io winner announcement.</i>',
                       ParagraphStyle('caption4', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))

story.append(add_subsection('4.2 Sui Overflow 2024 — Foundational Patterns'))
story.append(para(
    'The 2024 edition drew 352 submissions from 79 countries and produced 32 winners across eight '
    'tracks. Several winners became live protocols: Scallop, NAVI, Bucket, Typus, Haedal, '
    'SuiVision, and Releap all trace their origin to the 2023–2024 Sui hackathon cycle. The 2024 '
    'winner list includes Pandora Finance (DeFi composability), AresRPG (onchain gaming), Kraken '
    '(trading infrastructure), Sui dApp Starter (developer tooling, built solo by Kos Komelin — '
    'proof that solo builders can win tooling tracks), and Suibotics (which repeated as a winner '
    'in 2025, suggesting judges reward continued iteration on a strong concept). The 2024 data '
    'reinforces a key pattern: <b>novel single-primitive projects win tooling tracks; multi-primitive '
    'compositions win DeFi and AI tracks.</b>'
))

story.append(add_subsection('4.3 Other Web3 Hackathon Winning Patterns'))
story.append(para(
    'Looking outside Sui, the Solana AI Hackathon (January 2025, $50,000 top prize) produced '
    'DegenDomeSolana in first place, AgentOS by 0xbraindeds in second, and The Hive in third — '
    'all three were AI-agent projects with on-chain trading primitives. The Colosseum Solana Agent '
    'Hackathon (later in 2025) paid out $50,000 for first place and reinforced the pattern: AI '
    'agents that can autonomously trade, manage portfolios, and execute DeFi strategies win big. '
    'ETHGlobal\'s Agentic Ethereum hackathon (January–February 2025, $175,000 in prizes) showed '
    'the same pattern, with Etherius winning first place for an AI-powered NFT intelligence agent '
    'that lets users query real-time marketplace data in natural language. The Coinbase Onchain AI '
    'Hackathon (February 2025) and TON AI Agent Hackathon reinforced the trend.'
))

story.append(para(
    'The cross-hackathon pattern is unambiguous: <b>AI agents that combine natural-language '
    'interaction with on-chain action, persistent memory, and a clear real-world use case are the '
    'dominant winning pattern of 2025–2026.</b> This is precisely why AgentVault — an AI agent '
    'with persistent memory on Walrus that takes natural-language instructions and executes Sui '
    'transactions — fits the meta. It is not a derivative of any single past winner, but it '
    'synthesizes the winning pattern across multiple hackathons.'
))

story.append(add_subsection('4.4 Seven "What Wins" Principles'))
story.append(para(
    'Distilled from the catalog above, seven principles separate winning projects from also-rans. '
    'These principles are the design constraints for your build.'
))

principles = [
    '<b>1. Real-world deployability beats technical novelty.</b> Every 2025 winner is something a real user could plausibly use. SuiSign signs documents. PIVY makes payments privately. Suithetic generates training data. Build a thing, not a demo of a thing.',
    '<b>2. Compose three or more Sui primitives.</b> The strongest winners (ZeroLeaks, Sui Shadow, PactDa, Kensei) combine three or more primitives — typically Walrus + Seal + zkLogin or Walrus + Wormhole + AI. Single-primitive projects win tooling tracks but rarely top prizes.',
    '<b>3. Claim "first of its kind on Sui."</b> SuiSign is the first decentralized document signing on Sui. WalGraph is the first decentralized graph database on Sui. Numeron is the first fully onchain AI RPG on Sui. The "first" claim is a powerful narrative anchor for judges and Demo Day.',
    '<b>4. Web2-grade UX via zkLogin and sponsored transactions.</b> Projects that require the user to install a wallet and hold SUI for gas lose judges\' attention. Projects that let users log in with Google and pay no gas win it. zkLogin + sponsored transactions is the cheat code for Web2-grade UX.',
    '<b>5. Polished single-product beats feature-bloated suite.</b> PIVY, SuiSign, Suithetic, ZeroLeaks — all are single-feature products executed with polish. Resist the urge to add a fourth or fifth feature in the last 6 hours.',
    '<b>6. Demo video quality is the highest-leverage artifact.</b> Judges will watch your 5-minute video at 1.5x speed. If the first 30 seconds do not show a working product, you have lost. Script your video before you record it.',
    '<b>7. Mainnet-readiness signals long-term intent.</b> The prize split (50% on announcement, 50% on mainnet) is a filter. Teams that ship a credible mainnet path — even just a documented plan — outscore teams that treat mainnet as a future problem.',
]
for p in principles:
    story.append(Paragraph(p, BODY))
story.append(Spacer(1, 6))


# ═══════════════════════════════════════════════════════════════
# CHAPTER 5 — JUDGING CRITERIA DECODED
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 5 — Judging Criteria Decoded: Where the Points Are', H1))

story.append(para(
    'The Sui Overflow 2026 judging criteria are publicly stated and weighted. Projects are scored '
    'across four dimensions: Product & UX (20%), Real-World Application (50%), Technical '
    'Implementation (20%), and Presentation & Vision (10%). The single most important fact in this '
    'chapter is the weight distribution: half of your entire score comes from Real-World Application. '
    'A project with weak code but a strong real-world narrative will outscore a project with '
    'elegant code and a weak narrative. This should reorient every decision you make in the next '
    'twenty-four hours.'
))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Criterion', 'Weight', 'What Judges Actually Look For', 'How to Score Max Points'],
    ['Product & UX', '20%', 'Quality, usability, polish, overall UX', 'Working frontend with 3+ user-tested screens; clear primary user flow; no broken buttons; consistent visual design'],
    ['Real-World Application', '50%', 'Meaningful problem-solving, market relevance, long-term value', 'Crisp problem statement; named user persona; market-size estimate; defensibility argument; post-hackathon roadmap'],
    ['Technical Implementation', '20%', 'Technical quality, reliability, meaningful Sui integration', 'Multi-primitive composition (Walrus + zkLogin + sponsored tx); testnet deployment with verified package ID; clean repo with README + architecture diagram'],
    ['Presentation & Vision', '10%', 'Clarity, storytelling, long-term vision', '5-min demo video with clear narrative arc; one-sentence vision; Demo Day pitch with concrete roadmap'],
], col_ratios=[0.18, 0.08, 0.36, 0.38]))
story.append(Paragraph('<i>Table 4. Judging criteria decoded. Real-World Application is 50% of the score — your narrative matters more than your codebase size.</i>',
                       ParagraphStyle('caption5', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))

story.append(add_subsection('5.1 The 50% Insight and Its Implications'))
story.append(para(
    'Because Real-World Application is half the score, your project decisions should be made '
    'through the lens of "what is the real-world problem?" before "what is the technical '
    'architecture?" The AgentVault recommendation in Chapter 7 is structured this way: the '
    'real-world problem is "AI agents today are stateless — they forget user preferences across '
    'sessions, lose context between conversations, and cannot act on the user\'s behalf on-chain." '
    'The technical architecture (Walrus + MemWal + zkLogin + sponsored tx) is the answer to that '
    'problem, not the starting point. Every paragraph of your README, every minute of your demo '
    'video, and every slide of your Demo Day pitch should orbit the real-world problem statement.'
))

story.append(add_subsection('5.2 The 5-Minute Demo Video — Scripting for Maximum Score'))
story.append(para(
    'Your demo video is the single highest-leverage artifact in the entire submission. Judges '
    'will watch it at 1.5x speed, often while reviewing twenty other submissions in the same '
    'session. The first 30 seconds determine whether they pay attention or zone out. The '
    'recommended script structure for AgentVault\'s five-minute demo, mapped to judging criteria:'
))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Time', 'Content', 'Criterion Targeted'],
    ['0:00–0:20', 'Problem statement: "AI agents are stateless. We fix this on Sui."', 'Real-World Application'],
    ['0:20–1:00', 'Solution overview: AgentVault = AI agent + Walrus memory + gasless Sui tx', 'Real-World Application'],
    ['1:00–2:30', 'Live demo: user logs in with Google (zkLogin), chats with agent, agent remembers preferences from prior session (MemWal), executes a Sui transfer on user behalf (sponsored tx)', 'Product & UX'],
    ['2:30–3:30', 'Technical deep-dive: architecture diagram, Walrus blob storage, MemWal delegate key, Move contract for agent action', 'Technical Implementation'],
    ['3:30–4:15', 'Real-world use cases: personal AI finance assistant, on-chain gaming agent, autonomous DAO delegate', 'Real-World Application'],
    ['4:15–5:00', 'Roadmap: mainnet in 30 days, multi-agent coordination, deepening DeepBook integration for trading agents', 'Presentation & Vision'],
], col_ratios=[0.14, 0.62, 0.24]))
story.append(Paragraph('<i>Table 5. Recommended 5-minute demo video script. Each segment maps to a specific judging criterion to maximize weighted score.</i>',
                       ParagraphStyle('caption6', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))

story.append(add_subsection('5.3 What Judges Hate'))
story.append(para(
    'Three failure modes consistently annoy judges. <b>First, vaporware</b>: a beautiful landing '
    'page with no working product behind it. If your demo video shows screenshots instead of a '
    'live product, you will lose points across Product, Technical, and Presentation. <b>Second, '
    'fork-without-credit</b>: a project that is clearly a fork of an existing repo with a new '
    'UI skin and no novel functionality. The rules permit extending existing code, but you must '
    'disclose it; concealment is an instant disqualifier in judges\' minds. <b>Third, '
    'no-deployment</b>: a project that runs only on localhost. The handbook requires testnet or '
    'mainnet deployment at the time of shortlisting. A missing package ID in your submission is '
    'a red flag that may keep you off the shortlist entirely.'
))


# ═══════════════════════════════════════════════════════════════
# CHAPTER 6 — TECH STACK MAP
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 6 — Sui Ecosystem Tech Stack Map', H1))

story.append(para(
    'The Sui ecosystem has accumulated a distinctive set of primitives over the past three years. '
    'Each primitive addresses a different friction in Web3 development. A winning project typically '
    'composes three or more of these primitives into a coherent user experience. This chapter '
    'maps every primitive you might use, rates its 24-hour buildability, and recommends which to '
    'pick for the AgentVault project.'
))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Primitive', 'What It Does', '24h Buildability', 'Use in AgentVault?'],
    ['Move smart contracts', 'Sui\'s native smart contract language; resource-oriented, object model', '★★★☆☆ (3/5)', 'Yes — minimal contract for agent action'],
    ['Programmable Transaction Blocks (PTBs)', 'Bundle up to 1024 operations in a single atomic transaction', '★★★★☆ (4/5)', 'Yes — for multi-step agent actions'],
    ['zkLogin', 'Web2 social login (Google, Apple, etc.) → Sui wallet; no seed phrase', '★★★★☆ (4/5)', 'Yes — primary user auth'],
    ['Sponsored transactions', 'DApp pays gas; user signs only the intent; gasless UX', '★★★★☆ (4/5)', 'Yes — for gasless agent actions'],
    ['Walrus', 'Decentralized storage layer; verifiable data; ~$0.01/MB', '★★★★★ (5/5)', 'Yes — primary storage'],
    ['MemWal (Walrus Memory)', 'Hierarchical short/long-term memory layer for AI agents on Walrus', '★★★★★ (5/5)', 'Yes — core feature'],
    ['Seal', 'Encryption layer for Walrus and MemWal; programmable permissions', '★★★★☆ (4/5)', 'Optional — for encrypted memory'],
    ['DeepBook v3', 'Fully on-chain order book on Sui; shared liquidity, low latency', '★★☆☆☆ (2/5)', 'No — out of scope for 24h'],
    ['DeepBook Predict', 'Expiry-based binary prediction market protocol on Sui', '★★★☆☆ (3/5)', 'No — see PredictPilot (Ch. 7)'],
    ['SuiNS', 'Sui Name Service; human-readable .sui names for addresses', '★★★★★ (5/5)', 'Optional — for user identity'],
    ['Kiosk', 'Sui primitive for NFT sale/transfer with custom rules', '★★★☆☆ (3/5)', 'No'],
    ['Walrus Sites', 'Decentralized websites hosted on Walrus; site-builder CLI', '★★★★☆ (4/5)', 'Yes — for decentralized mirror'],
], col_ratios=[0.21, 0.42, 0.16, 0.21]))
story.append(Paragraph('<i>Table 6. Sui ecosystem primitives mapped against 24-hour buildability and AgentVault fit. Star ratings reflect cold-start difficulty + sample-code availability + documentation quality.</i>',
                       ParagraphStyle('caption7', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))

story.append(add_subsection('6.1 Why MemWal Is the Highest-Leverage 24-Hour Primitive'))
story.append(para(
    'MemWal is the highest-leverage primitive available to you because it solves the hardest '
    'problem in AI agent development — persistent memory — with a hosted playground, a TypeScript '
    'SDK, a documented delegate-key model, and several sample applications in the official GitHub '
    'repo. The MemWal workshop (completed during the hackathon build period, video available at '
    'the link in the resource hub) walks through creating an agent account, generating a delegate '
    'key, and storing conversation context as encrypted blobs on Walrus. A solo builder who '
    'follows this workshop can have a working MemWal integration in 90 minutes. No other primitive '
    'in the Sui ecosystem offers this kind of cold-start leverage.'
))

story.append(add_subsection('6.2 Why zkLogin + Sponsored Transactions Is the UX Cheat Code'))
story.append(para(
    'The combination of zkLogin (Web2 social login → Sui wallet) and sponsored transactions '
    '(dApp pays gas) eliminates the two biggest UX frictions in Web3: seed phrases and gas fees. '
    'A user can log in with Google, interact with your agent, and execute an on-chain action '
    'without ever installing a wallet, acquiring SUI, or signing a transaction with gas. This is '
    'the Web2-grade UX that principle 4 in Chapter 4 identifies as a winning pattern. Both '
    'primitives have TypeScript SDK support and are documented in the Sui developer portal. The '
    'zkLogin integration takes roughly 2 hours; the sponsored-transaction relay takes another '
    '2 hours. Both are achievable in the build window.'
))

story.append(add_subsection('6.3 The Move Contract — Keep It Minimal'))
story.append(para(
    'For AgentVault, the Move contract should be minimal: a single module with one entry function '
    'that takes an intent string, a user signature, and a target action, then executes a SUI '
    'transfer. Resist the urge to build a complex contract with multiple entry functions, '
    'permissioned roles, or on-chain governance. The contract is the smallest piece of the '
    'project; the AI agent, MemWal integration, zkLogin flow, and frontend are the larger pieces. '
    'A 50-line Move module that compiles, deploys to testnet, and is verifiable on the Sui '
    'explorer beats a 500-line module that does not compile by hour 22.'
))


# ═══════════════════════════════════════════════════════════════
# CHAPTER 7 — RECOMMENDED TRACK PICK + PROJECT IDEAS
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 7 — Recommended Track Pick + Project Ideas', H1))

story.append(para(
    'This chapter formalizes the AgentVault recommendation and presents two backup project ideas '
    '(TruthLedger and PredictPilot) for builders who want to weigh alternatives. All three are '
    'scoped to a 24-hour AI-assisted build with the Sui ecosystem primitives cataloged in '
    'Chapter 6. Each project idea includes the real-world problem, the proposed solution, the '
    'tech stack, the MVP scope, and a strategic assessment of how it scores against the judging '
    'criteria from Chapter 5.'
))

story.append(add_subsection('7.1 Primary Recommendation: AgentVault'))
story.append(callout_box(
    'AGENTVAULT — Walrus Track',
    '<b>Problem:</b> AI agents are stateless. They forget user preferences across sessions, lose '
    'context between conversations, and cannot act on the user\'s behalf on-chain. Every ChatGPT '
    'session starts from zero. Every Web3 wallet interaction requires manual signing.<br/><br/>'
    '<b>Solution:</b> AgentVault is an AI agent with persistent memory on Walrus (via MemWal) that '
    'executes gasless Sui transactions on behalf of the user. Users log in with Google (zkLogin), '
    'chat with their agent, and the agent remembers preferences, context, and intent across '
    'sessions — encrypted and stored on Walrus. When the user says "send 0.1 SUI to my friend," '
    'the agent constructs, signs (with user confirmation), and submits the transaction via '
    'sponsored transaction.<br/><br/>'
    '<b>Track:</b> Walrus ($35,000 1st prize) — explicit fit: "AI agents and agentic workflows '
    'powered by Walrus as a verifiable data and memory layer."<br/>'
    '<b>Primitives:</b> Walrus, MemWal, zkLogin, Sponsored Transactions, Move (minimal contract).<br/>'
    '<b>MVP scope:</b> Chat UI + MemWal memory + 1 on-chain action (SUI transfer).<br/>'
    '<b>Build time:</b> 20–24 hours with AI assistance.<br/>'
    '<b>Real-world use cases:</b> Personal AI finance assistant, on-chain gaming agent, autonomous '
    'DAO delegate, persistent Web3 customer-support agent.',
    color=ACCENT
))

story.append(add_subsection('7.2 Backup Option A: TruthLedger'))
story.append(para(
    'TruthLedger is a Walrus + Seal-powered verifiable claim storage platform for journalism, '
    'extending the ZeroLeaks pattern from Sui Overflow 2025. <b>Problem:</b> Journalists and '
    'whistleblowers have no cryptographically verifiable way to publish claims with attestation '
    'chains. <b>Solution:</b> TruthLedger lets journalists upload claims as encrypted blobs on '
    'Walrus, with Seal-based programmable permissions (e.g., "decrypt only after 30 days" or '
    '"decrypt only if 3 of 5 editors sign off"). Editors sign claims with zkLogin-attested '
    'identities. <b>Track:</b> Walrus. <b>Primitives:</b> Walrus, Seal, zkLogin. <b>MVP scope:</b> '
    'Upload claim → editor signoff → publish flow. <b>Build time:</b> 22–26 hours. <b>Strategic '
    'assessment:</b> Stronger real-world narrative (journalism + truth is a powerful Demo Day '
    'story), weaker technical differentiation (ZeroLeaks set the template, judges may see this '
    'as derivative). Recommended as primary only if you have a strong journalism use-case contact.'
))

story.append(add_subsection('7.3 Backup Option B: PredictPilot'))
story.append(para(
    'PredictPilot is a DeepBook Predict bot with AI-driven market analysis. <b>Problem:</b> '
    'Binary prediction markets on DeepBook Predict require constant monitoring and rapid '
    'position management that human traders cannot sustain. <b>Solution:</b> PredictPilot is an '
    'AI agent that monitors DeepBook Predict markets, analyzes them with an LLM, and submits '
    'trades on the user\'s behalf via the DeepBook TypeScript SDK. <b>Track:</b> DeepBook '
    '($35,000 1st prize). <b>Primitives:</b> DeepBook v3, DeepBook Predict, Move, Sui TypeScript '
    'SDK. <b>MVP scope:</b> Market watcher + AI analysis + 1 trade execution. <b>Build time:</b> '
    '24–28 hours. <b>Strategic assessment:</b> Highest prize ceiling, highest technical difficulty. '
    'Recommended only if you have prior trading or DeFi experience. Skip if you have not previously '
    'integrated with DeepBook or another on-chain order book.'
))

story.append(add_subsection('7.4 Why AgentVault Wins the Comparison'))
story.append(Spacer(1, 6))
story.append(make_table([
    ['Dimension', 'AgentVault', 'TruthLedger', 'PredictPilot'],
    ['Track prize', '$35,000 (Walrus)', '$35,000 (Walrus)', '$35,000 (DeepBook)'],
    ['24h feasibility', 'High', 'Medium-High', 'Medium-Low'],
    ['Cold-start leverage', 'MemWal SDK + samples', 'Seal samples', 'DeepBook samples'],
    ['Multi-primitive composition', 'Walrus + MemWal + zkLogin + sponsored tx (4)', 'Walrus + Seal + zkLogin (3)', 'DeepBook + Move + SDK (3)'],
    ['Real-world narrative strength', 'Very high (AI agent + memory)', 'High (journalism + truth)', 'Medium (trading bot)'],
    ['Differentiation from 2025 winners', 'Novel synthesis', 'Derivative of ZeroLeaks', 'Novel'],
    ['Demo Day wow factor', 'High (live chat + on-chain action)', 'High (story)', 'Medium (numbers)'],
    ['Mainnet readiness in 30 days', 'Yes', 'Yes', 'Yes (with caveats)'],
    ['Overall recommendation', 'PRIMARY', 'Backup A', 'Backup B'],
], col_ratios=[0.27, 0.25, 0.24, 0.24]))
story.append(Paragraph('<i>Table 7. Comparison of three project ideas across 10 strategic dimensions. AgentVault is the primary recommendation.</i>',
                       ParagraphStyle('caption8', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))


# ═══════════════════════════════════════════════════════════════
# CHAPTER 8 — PROJECT BLUEPRINT
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 8 — Project Blueprint: AgentVault Architecture', H1))

story.append(para(
    'This chapter specifies the AgentVault architecture in enough detail that a builder can '
    'begin implementation immediately. The architecture is deliberately conventional: every '
    'component is a proven pattern, every integration has working sample code, and the entire '
    'system can be deployed to Vercel + Sui testnet + Walrus testnet in under an hour. The goal '
    'is to minimize the number of original engineering decisions you have to make in the build '
    'window.'
))

story.append(add_subsection('8.1 Component Stack'))
story.append(Spacer(1, 6))
story.append(make_table([
    ['Layer', 'Technology', 'Why This Choice'],
    ['Frontend', 'Next.js 16 + shadcn/ui + Tailwind CSS', 'Vercel deployment in 60 seconds; shadcn gives 30+ polished components for free; Tailwind handles responsive layout'],
    ['AI agent', 'OpenAI GPT-4o or Anthropic Claude via API', 'Best-in-class reasoning; function-calling for tool use; both have TypeScript SDKs'],
    ['Memory', 'MemWal TypeScript SDK', 'Official Walrus Memory layer; delegate-key model; sample apps in repo'],
    ['Storage', 'Walrus (testnet) for encrypted blobs', 'Decentralized, verifiable, ~$0.01/MB on mainnet, free on testnet'],
    ['Auth', 'zkLogin with Google provider', 'Web2-grade UX; users log in with Google; no seed phrase; Sui TypeScript SDK has built-in support'],
    ['Execution', 'Sui TypeScript SDK + sponsored transaction relay', 'Gasless UX; user signs only the intent; dApp pays gas'],
    ['Smart contract', 'Move (minimal agent_action module)', 'Single entry function: takes intent, signature, target → executes SUI transfer'],
    ['Hosting', 'Vercel (frontend) + Walrus Sites (decentralized mirror)', 'Vercel for fast iteration; Walrus Sites for the decentralized deployment story'],
    ['Repo', 'GitHub (public from the start)', 'Submission requirement; judges need access during judging period'],
    ['Wallet for testing', 'Sui CLI wallet (testnet)', 'Generate testnet address, request testnet SUI from faucet, sign transactions'],
], col_ratios=[0.18, 0.32, 0.50]))
story.append(Paragraph('<i>Table 8. AgentVault component stack. Every choice prioritizes proven patterns and 24-hour feasibility over novelty.</i>',
                       ParagraphStyle('caption9', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))

story.append(add_subsection('8.2 Architecture Diagram (Text Description)'))
story.append(para(
    'The AgentVault data flow is: <b>User</b> (browser) → <b>Next.js frontend</b> → '
    '<b>zkLogin modal</b> (Google OAuth) → returns Sui address. User then chats in the '
    'agent UI; each message goes to <b>LLM API</b> (OpenAI/Claude) which returns a response + '
    'optionally a function call to "execute_sui_action." The agent retrieves prior conversation '
    'context from <b>MemWal</b> (which stores encrypted blobs on <b>Walrus</b>) before each LLM '
    'call and writes the new turn back to MemWal after. When the agent decides to act on-chain, '
    'it constructs a transaction via <b>Sui TypeScript SDK</b>, submits to the <b>sponsored '
    'transaction relay</b> (a small Node.js service running on Vercel), which signs and submits '
    'to <b>Sui testnet</b>. The Move contract <b>agent_action::execute</b> validates the intent '
    'and executes a SUI transfer. The transaction hash is returned to the UI and displayed to '
    'the user with a link to the Sui testnet explorer.'
))

story.append(add_subsection('8.3 What to Ship vs What to Cut'))
story.append(Spacer(1, 6))
story.append(make_table([
    ['Category', 'Ship (MVP)', 'Cut (Out of Scope for 24h)'],
    ['Agent capabilities', 'Chat + persistent memory + 1 on-chain action (SUI transfer)', 'Multi-action agent (swaps, staking, NFT minting, DAO voting)'],
    ['Auth', 'zkLogin with Google only', 'Apple, Facebook, Twitch providers'],
    ['Memory', 'Single user, single conversation thread, last 50 turns', 'Multi-agent, shared memory, vector search, summarization'],
    ['UI', 'Single chat page + wallet connection banner + transaction receipt toast', 'Dashboard, history page, settings page, analytics'],
    ['Smart contract', '1 module, 1 entry function, 1 transfer action', 'Permissioned roles, governance, multi-action dispatcher'],
    ['Sponsored tx', 'Single relay service on Vercel', 'Rate limiting, abuse detection, fee budgets'],
    ['Deployment', 'Testnet only', 'Mainnet (defer to post-hackathon 30-day plan)'],
    ['Documentation', 'README with problem statement, architecture diagram, setup, demo video link', 'Full API docs, contribution guide, deploy guide'],
    ['Testing', 'Manual smoke test of primary flow', 'Unit tests, integration tests, E2E tests'],
], col_ratios=[0.18, 0.42, 0.40]))
story.append(Paragraph('<i>Table 9. Ship vs cut list for the 24-hour AgentVault build. The MVP scope is intentionally minimal — polish beats feature count.</i>',
                       ParagraphStyle('caption10', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))


# ═══════════════════════════════════════════════════════════════
# CHAPTER 9 — THE 24-HOUR BUILD PLAN
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 9 — The 24-Hour Build Plan', H1))

story.append(para(
    'This is the hour-by-hour build plan. It assumes you start at hour 0 and submit at hour 24. '
    'If you have less than 24 hours, the plan compresses by trimming Chapter 9 Phase 5 (polish) '
    'and Chapter 9 Phase 6 (submission buffer). If you have more than 24 hours, the extra time '
    'should go into Phase 5 (polish) and rehearsing the demo video. The schedule is calibrated '
    'for one builder using AI-assisted development tools (Claude Code, Cursor, GitHub Copilot, '
    'or similar). Adjust upward if you are not using AI assistance; do not adjust downward.'
))

story.append(add_subsection('9.1 Phase 1: Setup (Hours 0–2)'))
story.append(para(
    '<b>Goal:</b> Have every account, tool, and access token ready before writing any application '
    'code. The cold-start is where 24-hour builds lose the most time — a missing API key or a '
    'broken CLI install can eat two hours. <b>Tasks:</b> Register on DeepSurge and join the '
    'Overflow Telegram. Install Sui CLI (follow docs.sui.io). Generate a testnet address and '
    'request testnet SUI from the faucet. Create a GitHub repo (public). Set up a Vercel account '
    'and link it to the repo. Get an OpenAI API key (or Anthropic). Visit the MemWal playground, '
    'create an account, generate a delegate key for your agent — save the delegate key in a '
    'secrets file. Install Node.js 20+ and pnpm. Scaffold a Next.js 16 app with shadcn/ui. '
    'Fork the MemWal sample app repo as a reference. Bookmark the Walrus docs, Sui SDK docs, '
    'and the OpenZeppelin Move libraries. <b>Exit criteria:</b> Sui CLI works, testnet wallet '
    'funded, GitHub repo created, Vercel project linked, MemWal delegate key in hand, Next.js '
    'app running on localhost.'
))

story.append(add_subsection('9.2 Phase 2: Core Build (Hours 2–6)'))
story.append(para(
    '<b>Goal:</b> Working chat UI + MemWal memory integration + LLM API. <b>Tasks:</b> Build the '
    'chat UI (one page, message list, input box, send button). Integrate the OpenAI API for LLM '
    'responses with function-calling enabled. Integrate the MemWal SDK: before each LLM call, '
    'load the last 50 conversation turns from MemWal; after each LLM response, write the new '
    'turn to MemWal. Test the memory: start a conversation, close the browser, reopen, verify '
    'the agent remembers prior context. <b>Exit criteria:</b> User can chat with the agent, '
    'agent remembers prior conversation across page reloads, all memory is stored on Walrus '
    '(verifiable via Walrus explorer). <b>Critical risk:</b> If MemWal integration breaks, '
    'spend no more than 90 minutes debugging; if still broken, fall back to local storage and '
    'flag this in your README as "Walrus integration in progress."'
))

story.append(add_subsection('9.3 Phase 3: Move Contract + On-Chain Action (Hours 6–12)'))
story.append(para(
    '<b>Goal:</b> Minimal Move contract deployed to testnet + working on-chain action from the '
    'agent. <b>Tasks:</b> Write the agent_action Move module (single entry function, ~50 lines). '
    'Compile and deploy to Sui testnet using Sui CLI; record the package ID. Integrate the Sui '
    'TypeScript SDK into the Next.js app. Implement the sponsored transaction relay as a Vercel '
    'serverless function. Implement zkLogin with Google as the provider. Wire the agent\'s '
    'function-call "execute_sui_action" to: construct a PTB, request user signature via zkLogin, '
    'submit via sponsored relay, return the transaction hash. <b>Exit criteria:</b> User logs in '
    'with Google, chats with agent, agent can propose a SUI transfer, user confirms, transaction '
    'executes on testnet, hash returned and displayed. <b>Critical risk:</b> If zkLogin or '
    'sponsored tx proves too complex by hour 10, fall back to a standard Sui wallet (Sui Wallet '
    'extension) for signing and skip sponsored tx; flag this as a known limitation in the README.'
))

story.append(add_subsection('9.4 Phase 4: Polish (Hours 12–18)'))
story.append(para(
    '<b>Goal:</b> Production-quality frontend, clean repo, working deployment. <b>Tasks:</b> '
    'Polish the UI: loading states, error states, transaction receipts, empty states, mobile '
    'responsive. Write the README: problem statement (1 paragraph), solution overview (1 '
    'paragraph), architecture diagram (use excalidraw or mermaid), setup instructions (numbered '
    'list), demo video link (placeholder for now), screenshots (3–5). Add a .env.example file. '
    'Deploy to Vercel — verify the production URL works end-to-end. Create a Walrus Site '
    'mirror using the site-builder CLI (optional but adds a strong decentralized-deployment '
    'narrative). Add a LICENSE file (MIT). Add a screenshot of the Walrus explorer showing your '
    'agent\'s memory blobs. <b>Exit criteria:</b> Vercel URL works on a fresh browser without '
    'any console errors; README is complete; repo is presentable.'
))

story.append(add_subsection('9.5 Phase 5: Testnet Verification + Demo Video (Hours 18–22)'))
story.append(para(
    '<b>Goal:</b> Recorded 5-minute demo video uploaded to YouTube (unlisted). <b>Tasks:</b> '
    'Run the full end-to-end flow on testnet one more time, capturing screenshots of every '
    'screen. Script the demo video using the structure in Table 5 (Chapter 5). Record the demo '
    'using Loom, OBS, or QuickTime — capture the screen at 1920x1080, voice-over with a USB '
    'mic. Edit to exactly 5:00 or shorter using Descript, iMovie, or Kapwing. Upload to YouTube '
    'as unlisted. Copy the YouTube URL. <b>Exit criteria:</b> YouTube URL works in incognito '
    'mode; video is ≤5:00; first 30 seconds show the problem + solution clearly. <b>Critical '
    'risk:</b> If recording takes longer than 2 hours, switch to a simpler recording setup '
    '(no editing, single take, voice-over live). A 5-minute single-take video beats a 4-minute '
    'edited video that you cannot finish.'
))

story.append(add_subsection('9.6 Phase 6: Submission (Hours 22–24)'))
story.append(para(
    '<b>Goal:</b> Submitted on DeepSurge with all required fields. <b>Tasks:</b> Generate a '
    '1:1 project logo (use Figma, Canva, or an AI image generator; 1024x1024 PNG). Write the '
    'project description (1 paragraph: what + why). Verify the GitHub repo is public. Verify '
    'the demo video URL is correct. Verify the deployment URL (Vercel) works. Verify the '
    'package ID is correct (Sui testnet explorer). Fill out the DeepSurge submission form. '
    'Submit. Take a screenshot of the submission confirmation. <b>Exit criteria:</b> Submission '
    'confirmation screenshot saved; project visible on your DeepSurge profile.'
))

story.append(add_subsection('9.7 Decision Tree: What to Cut if Behind'))
story.append(para(
    'If at hour 18 you have not deployed to testnet, cut: (a) Walrus Sites mirror, (b) sponsored '
    'transactions (fall back to user-pays-gas with Sui Wallet extension), (c) polish on secondary '
    'screens. If at hour 20 you have not recorded the demo video, cut: (a) any remaining UI '
    'polish, (b) the Walrus Sites mirror, (c) README screenshots (use placeholder text). If at '
    'hour 22 the submission form is not yet started, drop everything and submit a minimal version '
    'with what you have. <b>An incomplete submission beats no submission every time.</b> A '
    'submitted project with a broken feature is still in the running; an unsubmitted project is '
    'not.'
))


# ═══════════════════════════════════════════════════════════════
# CHAPTER 10 — SUBMISSION CHECKLIST
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 10 — Submission Checklist & Final Hour Protocol', H1))

story.append(para(
    'The Sui Overflow 2026 submission requires nine specific fields. Each has a format requirement '
    'and a set of common mistakes that have historically kept projects off the shortlist. This '
    'chapter catalogs all nine fields with format specs, minimum viable versions, and common '
    'failure modes. Treat this as your final-hour pre-flight checklist.'
))

story.append(Spacer(1, 6))
story.append(make_table([
    ['Field', 'Requirement', 'Minimum Viable Version', 'Common Mistake'],
    ['Project Name', 'Clear + simple', '2–4 words; no jargon', '"AgentVault: Sui × Walrus × AI" (too long) → "AgentVault"'],
    ['Description', 'What it does + why it matters', '2–3 sentences; 1 what + 1 why + 1 differentiator', 'Marketing copy; technical jargon; no real-world framing'],
    ['Project Logo', '1:1 ratio, JPG or PNG', '1024×1024 PNG; clean icon on solid background', 'Rectangle logo; transparent background; tiny 64×64'],
    ['Public GitHub Repo', 'Public during judging period', 'Public from day 1; README with setup; clean .gitignore', 'Repo left private; no README; secrets committed; build artifacts pushed'],
    ['Demo Video', 'Required, ≤5 min, YouTube preferred', '5:00 or shorter; unlisted YouTube; first 30s = problem + solution', 'Vimeo link (judges prefer YouTube); 7-minute video (auto-truncated); no voiceover'],
    ['Website', 'Optional but highly recommended', 'Vercel URL with working primary flow', 'localhost URL (won\'t work for judges); broken production build'],
    ['Deployment', 'Testnet or Mainnet', 'Sui testnet; package ID verifiable on explorer', 'Localhost only; "deployment in progress"; mainnet URL that doesn\'t load'],
    ['Package ID', 'If deployed on-chain', 'Sui testnet package ID; copy-paste exactly', 'Wrong network (mainnet ID when you deployed to testnet); typo in ID'],
    ['Track Selection', 'One primary track only', 'Pick the track whose problem statement you best match', 'Submitting under multiple tracks; "Core Track" checkbox confusion'],
], col_ratios=[0.16, 0.21, 0.32, 0.31]))
story.append(Paragraph('<i>Table 10. Submission checklist with format requirements, minimum viable versions, and common mistakes.</i>',
                       ParagraphStyle('caption11', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))

story.append(add_subsection('10.1 Eligibility Rules That Bite'))
story.append(para(
    'Three eligibility rules are commonly misunderstood and have historically kept otherwise '
    'strong projects out of the running. <b>First, the build window rule:</b> the project must '
    'be built during the official build period (May 7 to June 21, 2026). If you are extending '
    'an existing project, the new functionality shipped during this window must be substantial '
    'and clearly disclosed in your submission. Concealment is a disqualifier. <b>Second, the '
    'deployment rule:</b> the project must be deployed to Sui mainnet or testnet at the time of '
    'shortlisting (July 8) and Demo Day (July 20–21). A project that is on localhost at '
    'shortlisting will not advance. <b>Third, the KYC rule:</b> at least one team member must '
    'pass KYC to receive prizes. If you win and no one on your team can pass KYC (e.g., due to '
    'OFAC-sanctioned region), the prize is forfeited. Verify your eligibility before submitting.'
))

story.append(add_subsection('10.2 Final Hour Protocol'))
story.append(para(
    'In the final hour before the deadline, do not start any new work. Run this protocol in '
    'order: (1) open the DeepSurge submission form and fill out every field except the final '
    'submit button; (2) verify the GitHub repo is public by opening it in an incognito window; '
    '(3) verify the YouTube demo video URL plays in incognito; (4) verify the Vercel URL loads '
    'in incognito; (5) verify the Sui testnet package ID by pasting it into the Sui testnet '
    'explorer; (6) click submit; (7) take a screenshot of the confirmation; (8) if anything '
    'fails, you have whatever time remains to fix it — but do not un-submit. A submitted project '
    'with a minor issue can be updated; an unsubmitted project cannot.'
))


# ═══════════════════════════════════════════════════════════════
# CHAPTER 11 — POST-HACKATHON
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 11 — Post-Hackathon: 50% Mainnet Prize + Builder Journey', H1))

story.append(para(
    'Winning the hackathon is the first half of the prize. The second half — the remaining 50% '
    'of the cash prize plus the $250,000+ in post-hackathon value — unlocks only with mainnet '
    'deployment. This chapter maps the 30-day path from winner announcement (August 27) to '
    'mainnet launch, and the longer Builder Journey that follows. If you treat mainnet as a '
    'future problem, you forfeit half your prize. If you plan for mainnet from day one, you '
    'claim the full prize and unlock the post-hackathon pipeline.'
))

story.append(add_subsection('11.1 The 50/50 Prize Split'))
story.append(para(
    'The official handbook states: "50% of the prize will be awarded upon announcement of '
    'winners; 50% of the prize will be awarded after successful mainnet deployment. If a '
    'winning team has already deployed their project to mainnet by the time winners are '
    'announced in August, they will receive 100% of the prize upfront." This is not a footnote; '
    'it is a structural incentive. A $35,000 first-place prize is functionally a $17,500 prize '
    'unless you mainnet-deploy. The strategic implication: design your project for mainnet '
    'deployment from day one, even if you only deploy to testnet during the hackathon.'
))

story.append(add_subsection('11.2 The 30-Day Mainnet Plan'))
story.append(Spacer(1, 6))
story.append(make_table([
    ['Phase', 'Days', 'Tasks', 'Exit Criteria'],
    ['Security Review', '1–7', 'Run Move linting; run OpenZeppelin Move library audit tools; fix all testnet bugs; review access controls; threat model the sponsored tx relay', 'No known vulnerabilities; all linting passes; relay audited for abuse'],
    ['Mainnet Dry Run', '8–14', 'Acquire mainnet SUI for gas; deploy Move contract to mainnet; run full flow on mainnet with small amounts; verify Walrus mainnet blob storage works', 'Contract deployed to mainnet with verified package ID; end-to-end flow works on mainnet'],
    ['Audit + KYC', '15–21', 'Coordinate with OtterSec or OpenZeppelin for an external review; complete KYC for at least one team member; coordinate with track sponsor on mainnet-readiness criteria', 'Audit report received (clean or with mitigations); KYC passed; sponsor sign-off'],
    ['Mainnet Launch', '22–30', 'Public mainnet launch announcement; deploy frontend to production Vercel + Walrus Sites mirror; publish launch blog post; submit mainnet package ID to claim second 50% of prize', 'Mainnet live; second 50% of prize claimed; launch announcement published'],
], col_ratios=[0.20, 0.10, 0.46, 0.24]))
story.append(Paragraph('<i>Table 11. 30-day post-hackathon mainnet plan. Each phase has explicit exit criteria. Skipping any phase risks the second 50% of the prize.</i>',
                       ParagraphStyle('caption12', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))

story.append(add_subsection('11.3 The Builder Journey Pipeline'))
story.append(para(
    'The official handbook describes a Builder Journey that extends well beyond mainnet launch: '
    '"Hackathon → Shortlisting → Demo Day → Winning → Mainnet Launch," followed by a pipeline '
    'of "ecosystem support and continued visibility, funding and hiring opportunities, '
    'accelerator introductions, office hours sessions and pitch deck breakdowns." This pipeline '
    'is the bridge from "hackathon project" to "venture-backed business." The 2023 Sui hackathon '
    'winners Scallop, NAVI, Bucket, Typus, and Haedal all crossed this bridge; several are now '
    'top-10 Sui protocols by TVL. The pipeline is not automatic — teams must pursue it — but '
    'the access is real: Sui Foundation introductions, Mysten Labs office hours, accelerator '
    'referrals, and pitch-deck reviews with the Builder Growth Team are all available to '
    'shortlisted and winning teams.'
))

story.append(add_subsection('11.4 Sui Basecamp 2026 and Beyond'))
story.append(para(
    'Top winning teams may be invited to pitch at Sui Basecamp 2026, the ecosystem\'s flagship '
    'in-person event. This is the highest-leverage post-hackathon opportunity: a Basecamp pitch '
    'puts you in front of Sui Foundation leadership, Mysten Labs engineers, ecosystem VCs, and '
    'live protocol teams looking to acquire or partner. Historically, Basecamp pitches have '
    'translated into pre-seed rounds, grants, and strategic partnerships. Plan your Demo Day '
    'presentation with the Basecamp pitch in mind — a clean 5-minute Demo Day pitch is the '
    'audition for a Basecamp slot.'
))


# ═══════════════════════════════════════════════════════════════
# CHAPTER 12 — PITFALLS, CUT LIST & FINAL ADVICE
# ═══════════════════════════════════════════════════════════════
story.extend(add_major_section('Chapter 12 — Pitfalls, Cut List & Final Tactical Advice', H1))

story.append(para(
    'This final chapter consolidates everything into three priority tiers and a short list of '
    'tactical advice. Read this chapter twice: once before you start building, and once at '
    'hour 18 when you are deciding what to cut. The priority tiers are the answer to the '
    'question "if I have to drop something, what drops first?"'
))

story.append(add_subsection('12.1 Priority Tiers'))
story.append(Spacer(1, 6))
story.append(make_table([
    ['Tier', 'Item', 'Why'],
    ['MUST (drop everything else first)', 'Testnet deployment with verified package ID', 'Hard submission requirement; without it, you cannot be shortlisted'],
    ['MUST', 'Working MemWal integration', 'Core feature of AgentVault; without it, the project is just another chatbot'],
    ['MUST', '5-minute demo video on YouTube', 'Hard submission requirement; often the only artifact judges fully review'],
    ['MUST', 'Public GitHub repo with README', 'Hard submission requirement; judges need access during judging period'],
    ['MUST', 'On-time submission', 'A submitted project beats no submission every time'],
    ['SHOULD (drop if behind)', 'Sponsored transactions for gasless UX', 'Strong UX story; ~2 hours to implement; fallback to user-pays-gas'],
    ['SHOULD', 'zkLogin with Google', 'Web2-grade UX; ~2 hours to implement; fallback to Sui Wallet extension'],
    ['SHOULD', 'Polished UI with loading/error/empty states', 'Judges notice polish; ~2 hours to add'],
    ['NICE (drop first if behind)', 'Mainnet readiness', 'Unlocks 2nd 50% of prize; defer to 30-day post-hackathon plan'],
    ['NICE', 'Multi-action agent (swaps, staking, NFT minting)', 'Scope creep risk; defer to post-hackathon iteration'],
    ['NICE', 'Analytics dashboard', 'Polish; defer'],
    ['NICE', 'Walrus Sites decentralized mirror', 'Adds narrative; defer if behind'],
], col_ratios=[0.22, 0.40, 0.38]))
story.append(Paragraph('<i>Table 12. Priority tiers for the 24-hour build. MUST items are non-negotiable; SHOULD items are strong leverage; NICE items are first to cut.</i>',
                       ParagraphStyle('caption13', fontName='FreeSerif-Italic', fontSize=8.5,
                                      leading=11, alignment=TA_CENTER, textColor=TEXT_MUTED,
                                      spaceBefore=4, spaceAfter=14)))

story.append(add_subsection('12.2 Final Tactical Advice'))
story.append(para(
    '<b>Do not over-engineer.</b> The most common 24-hour failure mode is building a 500-line '
    'Move contract when a 50-line contract would do. Every additional line of code is an '
    'additional line that can break, an additional line that needs to be debugged, an additional '
    'line that delays your submission. Keep the contract minimal. Keep the UI minimal. Keep the '
    'agent\'s action set minimal. Ship the smallest complete story you can ship.'
))
story.append(para(
    '<b>Leverage existing samples.</b> The MemWal SDK ships with sample apps. The awesome-sui '
    'repo has dozens of vetted Move modules. The OpenZeppelin Move libraries provide audited '
    'implementations of common patterns (access control, pausable, upgradeable). The Sui Move '
    'Bootcamp repo has end-to-end tutorials. The Sui Pilot repo has production-ready scaffolding. '
    'Use all of these. Do not write from scratch what already exists and is audited.'
))
story.append(para(
    '<b>Book office hours if time allows.</b> The hackathon runs office hours with OpenZeppelin '
    '(Daniel, Kose), Scallop (Kris), OtterSec (Michał), Mysten Labs (Jianyi, Tony for DeepBook), '
    'and Walrus (Abner). A 30-minute office hours session with the right mentor can unblock a '
    '2-hour problem in 5 minutes. Book sessions early — slots fill up.'
))
story.append(para(
    '<b>Post-submission polish for shortlisting.</b> After you submit on June 21, you can continue '
    'updating your repo. The handbook explicitly states these updates will not be considered '
    'during shortlisting — but they will be considered during Demo Day if you are shortlisted. '
    'Use the window between submission and shortlisting (June 21 to July 8) to fix bugs, add '
    'features, and rehearse your Demo Day pitch. A team that submits a working MVP on June 21 '
    'and polishes for Demo Day beats a team that submits a more polished MVP on June 21 and '
    'coasts.'
))

story.append(callout_box(
    'THE 24-HOUR BUILD MANTRA',
    'A working small thing beats a broken big thing. Ship the smallest complete story you can. '
    'Submit on time. Everything else is downstream of those two commitments.',
    color=ACCENT_2
))

story.append(Spacer(1, 18))
story.append(HRFlowable(width='100%', thickness=0.6, color=BORDER,
                        spaceBefore=8, spaceAfter=8))
story.append(Paragraph(
    '<i>This playbook was compiled from the official Sui Overflow 2026 handbook, the Sui Overflow '
    '2025 winner announcement, public Web3 hackathon records, and the Sui ecosystem developer '
    'documentation. Build well. Submit on time. See you on Demo Day.</i>',
    ParagraphStyle('closing', fontName='FreeSerif-Italic', fontSize=9, leading=13,
                   textColor=TEXT_MUTED, alignment=TA_CENTER)))


# ───────────────────────── BUILD ─────────────────────────
out_path = '/home/z/my-project/research/body.pdf'
doc = TocDocTemplate(
    out_path,
    pagesize=A4,
    leftMargin=1.0 * inch,
    rightMargin=1.0 * inch,
    topMargin=0.85 * inch,
    bottomMargin=0.75 * inch,
    title='Sui Overflow 2026 Builder Tactical Playbook',
    author='Z.ai',
    creator='Z.ai',
    subject='Sui Overflow 2026 hackathon strategy',
)
doc.multiBuild(story, onFirstPage=add_page_decoration, onLaterPages=add_page_decoration)
print(f'Body PDF generated: {out_path}')
