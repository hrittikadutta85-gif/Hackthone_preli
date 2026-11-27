# Sample dispatch exports

Generated offline by `python -m backend.export_samples`. The script switches the network off while it runs, so it
also shows that the dispatch templates need no internet or AI service.

**Scenario:** forecast made 7 Jul 2025 for the week of 21 Jul 2025 (2 weeks ahead) · regional stock 70% · 20 spraying
crews · supplies planned for the upper end of the 80% forecast range.

| File | What it is |
|---|---|
| `sms_alerts_en.txt` / `sms_alerts_bn.txt` | One SMS per ward that has something to act on. English fits one 160-character GSM-7 segment; Bangla is UCS-2 (the part count is listed). |
| `whatsapp_alerts_en.txt` / `whatsapp_alerts_bn.txt` | Longer WhatsApp notices with *bold* markup: risk, expected cases, allocated vs required supplies, beds and transfers, crews, deficit alert, actions. |
| `commissioner_brief_en.html` / `commissioner_brief_bn.html` | Printable commissioner brief for all five city corporations (A4, self-contained, no external files). |
| `commissioner_brief_en.pdf` | The English brief printed to PDF with headless Edge. |
| `commissioner_brief_dhaka_south_en.html` | The same brief for one city corporation. |
| `dispatch_notices.json` | Every notice in both languages, as the API returns them. |
| `allocation_plan.csv` | The full ward table: priority, required vs allocated saline/kits/beds, transfers, crews, status. |
| `overflow_transfers.csv` | Patient transfers between wards (always within the same city). |
| `vector_control_simulation.csv` | Automatic placement of the 20 crews, ranked by cases prevented per crew over weeks 2–4. |

To make a different scenario: `python -m backend.export_samples --origin 2025-06-23 --stock 60 --crews 15 --basis expected`.
In the web app, the Dispatch tab under Operations makes the same notices and briefs for whatever settings are on screen.
