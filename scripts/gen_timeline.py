#!/usr/bin/env python3
"""Generate the Sui Overflow 2026 timeline chart for the PDF report."""
import matplotlib
matplotlib.use('Agg')
# Skip addfont since variable fonts fail. Just rely on default fonts for matplotlib.
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
from matplotlib.patches import FancyBboxPatch
import matplotlib.dates as mdates
from datetime import datetime, timedelta

plt.rcParams['axes.unicode_minus'] = False

# Palette (must match cascade output)
PAGE_BG = '#f0f0f1'
HEADER_FILL = '#475b66'
ACCENT = '#2b6886'
ACCENT_2 = '#b76e4a'
TEXT_PRIMARY = '#151617'
TEXT_MUTED = '#80878a'
BORDER = '#b2c3cc'
SEM_ERROR = '#964e47'
SEM_WARNING = '#93773d'
SEM_SUCCESS = '#437a55'

# Timeline events
events = [
    # (date, label, phase, color, side)
    (datetime(2026, 5, 7),  'Official Launch',          'Launch',         ACCENT,    'up'),
    (datetime(2026, 5, 21), 'Building Period Midpoint', 'Building',       HEADER_FILL, 'down'),
    (datetime(2026, 6, 21), 'Submission Deadline\n6:00 PM PT\n(= Jun 22 6:30 AM IST)', 'Deadline', SEM_ERROR, 'up'),
    (datetime(2026, 7, 8),  'Shortlisted Teams\nAnnounced', 'Shortlist',  SEM_WARNING, 'down'),
    (datetime(2026, 7, 20), 'Demo Day - Agentic Web\n& Walrus Tracks',  'Demo Day', ACCENT_2, 'up'),
    (datetime(2026, 7, 21), 'Demo Day - DeFi & Payments\n& DeepBook Tracks', 'Demo Day', ACCENT_2, 'down'),
    (datetime(2026, 8, 27), 'Winners Announced\n(50% prize unlocked)', 'Winners',  SEM_SUCCESS, 'up'),
]

# Build figure
fig, ax = plt.subplots(figsize=(11.5, 5.4), constrained_layout=True)
fig.patch.set_facecolor(PAGE_BG)
ax.set_facecolor(PAGE_BG)

# Draw the main timeline arrow
start = datetime(2026, 5, 1)
end = datetime(2026, 9, 10)
ax.axhline(y=0, color=HEADER_FILL, linewidth=2.5, zorder=2, alpha=0.85)

# Highlight "last 24 hours" window
deadline_24h_start = datetime(2026, 6, 20, 18, 0)  # 24h before deadline
deadline = datetime(2026, 6, 21, 18, 0)
ax.axvspan(deadline_24h_start, deadline, alpha=0.20, color=SEM_ERROR, zorder=1)
ax.text(deadline_24h_start + (deadline - deadline_24h_start) / 2, 0.95,
        'LAST 24 HOURS\nWINDOW',
        ha='center', va='top', fontsize=8, color=SEM_ERROR,
        fontweight='bold', zorder=5,
        bbox=dict(boxstyle='round,pad=0.3', facecolor='white',
                  edgecolor=SEM_ERROR, linewidth=1, alpha=0.95))

# Plot events
for date, label, phase, color, side in events:
    y_offset = 0.45 if side == 'up' else -0.45
    va = 'bottom' if side == 'up' else 'top'
    # Marker dot
    ax.plot(date, 0, 'o', markersize=14, color=color,
            markeredgecolor='white', markeredgewidth=2, zorder=4)
    # Connector
    ax.plot([date, date], [0, y_offset * 0.55], color=color,
            linewidth=1.5, alpha=0.7, zorder=3)
    # Label box
    ax.text(date, y_offset * 0.65, label,
            ha='center', va=va, fontsize=8.5, color=TEXT_PRIMARY,
            fontweight='bold', zorder=5,
            bbox=dict(boxstyle='round,pad=0.45', facecolor='white',
                      edgecolor=color, linewidth=1.2, alpha=0.95))

# Phase legend strip
phases = [
    (datetime(2026, 5, 7), datetime(2026, 6, 21), 'Build Phase (45 days)', HEADER_FILL),
    (datetime(2026, 6, 21), datetime(2026, 7, 8), 'Judging', ACCENT),
    (datetime(2026, 7, 8), datetime(2026, 7, 21), 'Demo Day', ACCENT_2),
    (datetime(2026, 7, 21), datetime(2026, 8, 27), 'Final Judging', SEM_WARNING),
]
for s, e, name, c in phases:
    mid = s + (e - s) / 2
    ax.text(mid, -1.05, name, ha='center', va='center', fontsize=7.5,
            color=c, fontweight='bold', alpha=0.9)

# Format axis
ax.set_xlim(start, end)
ax.set_ylim(-1.3, 1.15)
ax.xaxis.set_major_locator(mdates.MonthLocator())
ax.xaxis.set_major_formatter(mdates.DateFormatter('%b %Y'))
ax.xaxis.set_minor_locator(mdates.WeekdayLocator(byweekday=mdates.MO))
ax.tick_params(axis='x', which='major', labelsize=9, colors=TEXT_MUTED)
ax.tick_params(axis='y', which='both', length=0, labelleft=False)
ax.spines['top'].set_visible(False)
ax.spines['right'].set_visible(False)
ax.spines['left'].set_visible(False)
ax.spines['bottom'].set_visible(False)

# Title
ax.set_title('Sui Overflow 2026 Hackathon Timeline — Pacific Time',
             fontsize=13, fontweight='bold', color=TEXT_PRIMARY,
             pad=12, loc='left')

# Save
out_path = '/home/z/my-project/research/timeline.png'
plt.savefig(out_path, dpi=200, facecolor=PAGE_BG, edgecolor='none')
print(f"Timeline saved to {out_path}")
plt.close()
