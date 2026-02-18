# Internship Outreach Copilot

This is a **Replit-ready** Python tool that automates internship outreach prep per company:

- company research from the company site
- contact extraction and scoring
- two role-specific email drafts
- follow-up and cooldown scheduling

## What this automates end-to-end

For each company row:

1. Crawls up to 6 internal pages (domain-limited).
2. Cleans content and extracts evidence-backed research facts.
3. Scores research confidence.
4. Extracts contact candidates from known contacts + discovered page emails.
5. Ranks contacts and selects:
   - Decision maker
   - Reachable operator
6. Generates two personalized emails using your requested template style.
7. Schedules follow-ups (+5 business days, +10 business days) and a 75-day cooldown.
8. Outputs a structured JSON object with review flags.

## What this does **not** do

- It does not send emails automatically (safety + account integration required).
- It does not scrape LinkedIn.

## Input CSV format

Required columns:

- `company_name`
- `website_url`
- `location`
- `industry_focus`
- `track_target` (or `track target`)
- `size_bucket` (`small`, `mid`, `large`, `unknown`)

Optional:

- `approach_hint`
- `known_contacts` format: `Name|Title|email; Name|Title|email`

## Run locally or in Replit

```bash
python internship_copilot.py --input companies.csv --output outreach_output.json
```

## Output schema per company

- `primary_contact`
- `secondary_contact`
- `research` (`bullets`, `confidence`)
- `email1`
- `email2`
- `followup_dates`
- `cooldown_until`
- `flags`:
  - `contact_needed`
  - `research_needed`
  - `needs_review`

## Reliability safeguards included

- Low research confidence forces generic company sentence.
- If only general inboxes are available, second email is suppressed and `contact_needed=true`.
- Draft validation enforces greeting/company mention/length constraints.
- Page cache with 7-day TTL is used to reduce repeated crawling and speed reruns.
