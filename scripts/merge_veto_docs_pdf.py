#!/usr/bin/env python3
"""Merge cover.pdf + body.pdf into final Veto docs PDF, normalized to A4."""
from pypdf import PdfReader, PdfWriter

A4_W, A4_H = 595.28, 841.89


def normalize_page_to_a4(page):
    page.mediabox.lower_left = (0, 0)
    page.mediabox.upper_right = (A4_W, A4_H)
    if hasattr(page, 'cropbox'):
        page.cropbox.lower_left = (0, 0)
        page.cropbox.upper_right = (A4_W, A4_H)
    return page


cover_pdf = '/home/z/my-project/research/veto_docs_cover.pdf'
body_pdf = '/home/z/my-project/research/veto_docs_body.pdf'
out_pdf = '/home/z/my-project/download/VETO_COMPLETE_DOCUMENTATION.pdf'

writer = PdfWriter()
cover_page = PdfReader(cover_pdf).pages[0]
writer.add_page(normalize_page_to_a4(cover_page))
for page in PdfReader(body_pdf).pages:
    writer.add_page(normalize_page_to_a4(page))
writer.add_metadata({
    '/Title': 'Veto — Complete Project Documentation',
    '/Author': 'Z.ai',
    '/Creator': 'Z.ai',
    '/Subject': 'Veto: deterministic, verifiable policy gate for AI agents on Sui — full architecture, file structure, logic, and deployment guide',
})
with open(out_pdf, 'wb') as f:
    writer.write(f)

import os
print(f'Final PDF: {out_pdf}')
print(f'Size: {os.path.getsize(out_pdf) / 1024:.1f} KB')
print(f'Pages: {len(PdfReader(out_pdf).pages)}')
