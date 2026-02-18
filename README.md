# Internship Outreach Copilot

A repeatable automation engine for cold outreach to internships, shadowing, and project-based opportunities.

## What it does

For each company row in your CSV, this tool:

1. Crawls up to 6 pages on the company domain.
2. Builds a research pack with evidence-backed facts and confidence scoring.
3. Extracts contact candidates from known contacts and discovered emails.
4. Scores and chooses two strategic contacts:
   - Decision maker
   - Reachable operator
5. Generates personalized email drafts using your template style.
6. Computes follow-up dates and cooldown windows.
7. Outputs a structured JSON record with flags for manual review.

## Input CSV columns

Required:
- `company_name`
- `website_url`
- `location`
- `industry_focus`
- `track_target` (or `track target`)
- `size_bucket` (`small`, `mid`, `large`, `unknown`)

Optional:
- `approach_hint`
- `known_contacts` in format: `Name|Title|email; Name|Title|email`

## Usage

```bash
python internship_copilot.py --input companies.csv --output outreach_output.json
```

## Output fields (per company)

- `primary_contact`
- `secondary_contact`
- `research` (2 bullets + confidence)
- `email1`
- `email2`
- `followup_dates`
- `cooldown_until`
- `flags` (`contact_needed`, `research_needed`, `needs_review`)

## Reliability safeguards included

- Low research confidence forces generic company sentence.
- Only general inboxes -> only one generated email + `contact_needed=true`.
- Draft validation checks greeting, company mention, sentence presence, and length.
- Follow-ups: +5 business days, then +10 business days.
- Cooldown: 75 days before restarting a new sequence at same company.
