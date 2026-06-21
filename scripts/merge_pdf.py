#!/usr/bin/env python3
"""Merge cover.pdf + body.pdf into final PDF, normalized to A4."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89


def normalize_page_to_a4(page):
    """Set mediabox to exact A4 dimensions without scaling content.
    pypdf's scale_to() wraps content in a transform matrix that breaks
    text extraction. Setting mediabox directly preserves content while
    normalizing the page dimensions."""
    page.mediabox.lower_left = (0, 0)
    page.mediabox.upper_right = (A4_W, A4_H)
    if hasattr(page, 'cropbox'):
        page.cropbox.lower_left = (0, 0)
        page.cropbox.upper_right = (A4_W, A4_H)
    return page


cover_pdf = '/home/z/my-project/research/cover.pdf'
body_pdf = '/home/z/my-project/research/body.pdf'
out_pdf = '/home/z/my-project/download/Sui_Overflow_2026_Builder_Tactical_Playbook.pdf'

writer = PdfWriter()
cover_page = PdfReader(cover_pdf).pages[0]
writer.add_page(normalize_page_to_a4(cover_page))
for page in PdfReader(body_pdf).pages:
    writer.add_page(normalize_page_to_a4(page))
writer.add_metadata({
    '/Title': 'Sui Overflow 2026 Builder Tactical Playbook',
    '/Author': 'Z.ai',
    '/Creator': 'Z.ai',
    '/Subject': 'Sui Overflow 2026 hackathon strategy and 24-hour build plan',
})
with open(out_pdf, 'wb') as f:
    writer.write(f)

print(f'Final PDF: {out_pdf}')
import os
print(f'Size: {os.path.getsize(out_pdf) / 1024:.1f} KB')
print(f'Pages: {len(PdfReader(out_pdf).pages)}')
