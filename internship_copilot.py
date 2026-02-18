from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import math
import re
import time
from dataclasses import asdict, dataclass, field
from typing import Dict, Iterable, List, Optional, Tuple
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

# =========================
# Fixed profile constants
# =========================
PROFILE = {
    "name": "Sriya Nallaparaju",
    "school": "Henrico High School",
    "location": "Glen Allen, VA",
    "program": "IB Diploma Program",
    "act": "36 (Math, Science, English, Reading)",
    "email": "sriya.nallaparaju@icloud.com",
    "phone": "(804) 300-5006",
}

PROOF_LINES = {
    "econ_research": "I've done professor-advised research on the global generic drug shortage, analyzing macroeconomic, regulatory, and supply-chain drivers.",
    "data_automation": "I've built Python, SQL, and Google Apps Script automations to streamline research and operational workflows at scale.",
    "business_ops": "I interned with UVA Darden, building internal tracking systems and improving operational workflows.",
    "web_ops": "I've worked on web and operations projects with a Richmond nonprofit tech team, improving digital infrastructure and systems.",
}

SKILL_CLUSTERS = {
    "data": "Python, SQL, statistical modeling, and workflow automation",
    "econ": "economic systems analysis, market structure, and policy-oriented research",
    "ops": "operations tracking, process improvement, and structured data workflows",
    "web": "web infrastructure, SEO/accessibility, and technical operations",
}

TRACK_MAP = {
    "ib": ("investment banking and finance", "econ", "econ_research"),
    "consulting": ("consulting and business strategy", "ops", "business_ops"),
    "tech/data": ("data and analytics", "data", "data_automation"),
    "econ research": ("economic and policy research", "econ", "econ_research"),
}

CATEGORY_KEYWORDS = {
    "what_they_do": ["provides", "offers", "specializes", "services", "solutions", "advisory"],
    "who_they_serve": ["clients", "customers", "institutions", "businesses", "organizations"],
    "capability": ["analytics", "strategy", "data", "research", "operations", "investment", "consulting"],
    "geography": ["virginia", "richmond", "dc", "washington", "regional", "global"],
    "values": ["mission", "values", "integrity", "commitment", "culture", "purpose"],
}

GENERAL_INBOX_PREFIXES = ("info@", "careers@", "contact@")


@dataclass
class CompanyInput:
    company_name: str
    website_url: str
    location: str = ""
    industry_focus: str = ""
    track_target: str = ""
    size_bucket: str = "unknown"
    approach_hint: str = ""
    known_contacts: str = ""


@dataclass
class FactItem:
    fact: str
    evidence_quote: str
    source_url: str
    category: str
    usable_in_email: bool


@dataclass
class ResearchPack:
    facts: List[FactItem] = field(default_factory=list)
    confidence: str = "Low"


@dataclass
class ContactCandidate:
    name: str
    title: str
    email: str
    page_url_source: str
    location: str = ""


@dataclass
class ScoredContact(ContactCandidate):
    authority: float = 0.0
    reply_likelihood: float = 0.0
    fit: float = 0.0
    final_score: float = 0.0


@dataclass
class EmailDraft:
    subject: str
    body: str


@dataclass
class CompanyOutput:
    company_name: str
    primary_contact: Optional[Dict]
    secondary_contact: Optional[Dict]
    research: Dict
    email1: Optional[Dict]
    email2: Optional[Dict]
    followup_dates: Dict[str, str]
    cooldown_until: str
    flags: Dict[str, bool]


class InternshipOutreachCopilot:
    def __init__(self, max_pages: int = 6, request_delay_s: float = 1.5):
        self.max_pages = max_pages
        self.request_delay_s = request_delay_s

    def process_company(self, company: CompanyInput, start_date: Optional[dt.date] = None) -> CompanyOutput:
        start_date = start_date or dt.date.today()

        page_texts = self._crawl_company_pages(company.website_url)
        research = self._extract_research_pack(page_texts)
        company_sentence = self._build_company_sentence(research, company.industry_focus)

        contacts = self._extract_contacts(company, page_texts)
        contact_needed = len(contacts) == 0

        scored = [self._score_contact(c, company.track_target, company.size_bucket, company.location) for c in contacts]
        primary, secondary = self._select_two_contacts(scored)

        research_needed = research.confidence == "Low"

        email1 = self._build_email(company, primary, company_sentence, decision_maker=True) if primary else None
        email2 = self._build_email(company, secondary, company_sentence, decision_maker=False) if secondary else None

        if self._only_general_inbox(contacts):
            # Reliability guard: only one email if only inboxes exist.
            email2 = None
            contact_needed = True

        flags = {
            "contact_needed": contact_needed,
            "research_needed": research_needed,
            "needs_review": False,
        }

        for draft in [email1, email2]:
            if draft and not self._validate_email_draft(draft.body, company.company_name):
                flags["needs_review"] = True

        followup_1 = self._add_business_days(start_date, 5)
        followup_2 = self._add_business_days(followup_1, 10)
        cooldown_until = start_date + dt.timedelta(days=75)

        return CompanyOutput(
            company_name=company.company_name,
            primary_contact=asdict(primary) if primary else None,
            secondary_contact=asdict(secondary) if secondary else None,
            research={
                "bullets": [asdict(x) for x in research.facts[:2]],
                "confidence": research.confidence,
            },
            email1=asdict(email1) if email1 else None,
            email2=asdict(email2) if email2 else None,
            followup_dates={
                "followup_1": followup_1.isoformat(),
                "followup_2": followup_2.isoformat(),
            },
            cooldown_until=cooldown_until.isoformat(),
            flags=flags,
        )

    # ---------- Crawl + research ----------

    def _crawl_company_pages(self, website_url: str) -> Dict[str, str]:
        seed = self._normalize_url(website_url)
        if not seed:
            return {}

        parsed_seed = urlparse(seed)
        allowed_host = parsed_seed.netloc
        preferred_paths = ["/", "/about", "/services", "/what-we-do", "/careers", "/news", "/blog", "/press", "/insights"]

        queue = [urljoin(seed, p) for p in preferred_paths]
        seen, results = set(), {}

        while queue and len(results) < self.max_pages:
            url = queue.pop(0)
            if url in seen:
                continue
            seen.add(url)

            if urlparse(url).netloc != allowed_host:
                continue

            text = self._fetch_page_text(url)
            if text and self._is_content_rich(text):
                results[url] = text
                links = self._extract_internal_links(text, url, allowed_host)
                for link in links:
                    if link not in seen and len(queue) < 30:
                        queue.append(link)
        return results

    def _fetch_page_text(self, url: str) -> str:
        try:
            req = Request(url, headers={"User-Agent": "Mozilla/5.0 InternshipOutreachBot/1.0"})
            with urlopen(req, timeout=12) as r:
                if "text/html" not in r.headers.get("Content-Type", ""):
                    return ""
                html = r.read().decode("utf-8", errors="ignore")
        except Exception:
            return ""
        finally:
            time.sleep(self.request_delay_s)

        # Keep raw HTML snippets for contact extraction; clean for research use.
        clean = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\1>", " ", html)
        clean = re.sub(r"(?is)<(nav|footer).*?>.*?</\1>", " ", clean)
        clean = re.sub(r"(?s)<[^>]+>", " ", clean)
        clean = re.sub(r"\s+", " ", clean).strip()
        return clean

    def _extract_internal_links(self, text: str, current_url: str, allowed_host: str) -> List[str]:
        # text here is cleaned; best effort link discovery from current URL only.
        return []

    def _is_content_rich(self, text: str) -> bool:
        return len(text) >= 800 and len(re.findall(r"[.!?]", text)) >= 6

    def _extract_research_pack(self, pages: Dict[str, str]) -> ResearchPack:
        items: List[FactItem] = []
        for url, text in pages.items():
            sents = self._split_sentences(text)
            for sent in sents:
                category = self._classify_sentence(sent)
                if not category:
                    continue
                evidence = self._extract_evidence(sent)
                usable = category != "values" and len(sent.split()) >= 8
                items.append(FactItem(
                    fact=sent.strip(),
                    evidence_quote=evidence,
                    source_url=url,
                    category=category,
                    usable_in_email=usable,
                ))
                if len(items) >= 30:
                    break
            if len(items) >= 30:
                break

        deduped = self._dedupe_fact_items(items)[:4]
        usable_count = sum(1 for x in deduped if x.usable_in_email)
        non_values_usable = any(x.usable_in_email and x.category != "values" for x in deduped)
        confidence = "OK" if usable_count >= 2 and non_values_usable else "Low"
        return ResearchPack(facts=deduped, confidence=confidence)

    def _split_sentences(self, text: str) -> List[str]:
        chunks = re.split(r"(?<=[.!?])\s+", text)
        return [c.strip() for c in chunks if 30 <= len(c.strip()) <= 260]

    def _classify_sentence(self, sentence: str) -> Optional[str]:
        lower = sentence.lower()
        for category, kws in CATEGORY_KEYWORDS.items():
            if any(k in lower for k in kws):
                return category
        return None

    def _extract_evidence(self, sentence: str) -> str:
        words = sentence.split()
        if len(words) < 6:
            return sentence
        end = min(len(words), 18)
        start = max(0, min(2, end - 6))
        quote = " ".join(words[start:end])
        return quote.strip('"')

    def _dedupe_fact_items(self, items: List[FactItem]) -> List[FactItem]:
        seen = set()
        out = []
        for item in items:
            key = (item.category, item.fact[:100].lower())
            if key in seen:
                continue
            seen.add(key)
            out.append(item)
        return out

    def _build_company_sentence(self, research: ResearchPack, industry_focus: str) -> str:
        if research.confidence != "OK":
            return f"I was interested in the work your organization does in {industry_focus or 'your field'}."

        candidates = [x for x in research.facts if x.usable_in_email and x.category != "values"]
        if not candidates:
            return f"I was interested in the work your organization does in {industry_focus or 'your field'}."

        fact = candidates[0].fact
        trimmed = fact.rstrip(".")
        return f"I was interested in your work and noted that {trimmed.lower()}."

    # ---------- Contacts + scoring ----------

    def _extract_contacts(self, company: CompanyInput, pages: Dict[str, str]) -> List[ContactCandidate]:
        candidates: List[ContactCandidate] = []
        if company.known_contacts:
            candidates.extend(self._parse_known_contacts(company.known_contacts, company.website_url, company.location))

        email_regex = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
        for url, text in pages.items():
            for match in email_regex.finditer(text):
                email = match.group(0).lower()
                name, title = self._guess_identity_from_email(email)
                if any(email == c.email for c in candidates):
                    continue
                candidates.append(ContactCandidate(name=name, title=title, email=email, page_url_source=url, location=company.location))

        # Add fallback general inboxes when same domain exists
        domain = urlparse(self._normalize_url(company.website_url) or "").netloc
        if domain:
            for prefix in GENERAL_INBOX_PREFIXES:
                email = f"{prefix}{domain}"
                if not any(c.email == email for c in candidates):
                    candidates.append(ContactCandidate(name="", title="General Inbox", email=email, page_url_source=company.website_url, location=company.location))

        return candidates

    def _parse_known_contacts(self, known: str, source_url: str, location: str) -> List[ContactCandidate]:
        # Format: Name|Title|email ; Name|Title|email
        out = []
        for part in known.split(";"):
            bits = [x.strip() for x in part.split("|")]
            if len(bits) == 3 and "@" in bits[2]:
                out.append(ContactCandidate(name=bits[0], title=bits[1], email=bits[2].lower(), page_url_source=source_url, location=location))
        return out

    def _guess_identity_from_email(self, email: str) -> Tuple[str, str]:
        local = email.split("@", 1)[0]
        if any(local.startswith(p[:-1]) for p in GENERAL_INBOX_PREFIXES):
            return "", "General Inbox"
        parts = re.split(r"[._-]+", local)
        if len(parts) >= 2 and all(p.isalpha() for p in parts[:2]):
            name = f"{parts[0].title()} {parts[1].title()}"
            return name, ""
        return "", ""

    def _score_contact(self, c: ContactCandidate, track: str, size_bucket: str, target_location: str) -> ScoredContact:
        authority = self._authority_score(c.title, size_bucket)
        reply = 0.0
        fit = 0.0

        if c.email:
            reply += 15
        if c.location and target_location and c.location.lower() in target_location.lower():
            reply += 15
        if re.search(r"manager|director|lead", c.title, flags=re.I):
            reply += 10
        if c.title.lower() == "general inbox":
            reply += 5
        if re.search(r"global head|chief|partner", c.title, flags=re.I) and size_bucket.lower() == "large":
            reply -= 15

        if self._title_matches_track(c.title, track):
            fit += 10
        elif c.title and not self._title_matches_track(c.title, track):
            fit -= 10

        final = 0.55 * authority + 0.35 * reply + 0.10 * fit
        return ScoredContact(**asdict(c), authority=authority, reply_likelihood=reply, fit=fit, final_score=round(final, 2))

    def _authority_score(self, title: str, size_bucket: str) -> float:
        t = (title or "").lower()
        sb = size_bucket.lower()

        if sb == "small":
            if re.search(r"founder|ceo|owner", t): return 80
            if "coo" in t: return 70
            if re.search(r"head|director", t): return 60
            if "ops" in t: return 55
            if "manager" in t: return 45
        elif sb == "mid":
            if "director" in t: return 70
            if "vp" in t: return 65
            if "senior manager" in t: return 55
            if "office lead" in t: return 50
        elif sb == "large":
            if re.search(r"ceo|chief|cfo|coo|cto", t): return 0
            if "senior manager" in t: return 65
            if "director" in t: return 60
            if re.search(r"team lead|manager", t): return 55
            if "office lead" in t: return 45

        if "general inbox" in t:
            return 20
        return 40

    def _title_matches_track(self, title: str, track: str) -> bool:
        title_l = (title or "").lower()
        track_l = (track or "").lower()
        mapping = {
            "ib": ["investment", "banking", "finance", "capital", "advisory"],
            "consulting": ["consult", "strategy", "operations", "advisory"],
            "tech/data": ["data", "analytics", "engineering", "technology"],
            "econ research": ["econom", "research", "policy", "analysis"],
        }
        kws = mapping.get(track_l, [])
        return any(k in title_l for k in kws)

    def _select_two_contacts(self, scored: List[ScoredContact]) -> Tuple[Optional[ScoredContact], Optional[ScoredContact]]:
        if not scored:
            return None, None

        sorted_contacts = sorted(scored, key=lambda c: c.final_score, reverse=True)
        primary = sorted_contacts[0]

        secondary = None
        for c in sorted_contacts[1:]:
            if self._seniority_tier(c.title) != self._seniority_tier(primary.title):
                secondary = c
                break
        if not secondary and len(sorted_contacts) > 1:
            secondary = max(sorted_contacts[1:], key=lambda x: x.reply_likelihood)

        return primary, secondary

    def _seniority_tier(self, title: str) -> str:
        t = (title or "").lower()
        if re.search(r"ceo|founder|chief|owner|partner", t): return "exec"
        if re.search(r"vp|director|head", t): return "director"
        if re.search(r"manager|lead|ops", t): return "manager"
        if "general inbox" in t: return "inbox"
        return "unknown"

    def _only_general_inbox(self, contacts: List[ContactCandidate]) -> bool:
        if not contacts:
            return False
        return all(c.title.lower() == "general inbox" for c in contacts)

    # ---------- Email generation ----------

    def _build_email(self, company: CompanyInput, contact: ScoredContact, company_sentence: str, decision_maker: bool) -> EmailDraft:
        track_phrase, skill_key, proof_key = TRACK_MAP.get((company.track_target or "").lower(), ("the field", "ops", "business_ops"))
        skill_cluster = SKILL_CLUSTERS[skill_key]
        proof_line = PROOF_LINES[proof_key]

        greeting = contact.name or contact.title or "there"

        if decision_maker:
            subject = "High School Senior Seeking Internship or Shadowing Opportunity"
            body = (
                f"Hello {greeting},\n\n"
                f"My name is {PROFILE['name']}, and I am a senior at {PROFILE['school']} in {PROFILE['location']} in the {PROFILE['program']}, with a strong interest in {track_phrase}.\n\n"
                f"{company_sentence}\n\n"
                f"Over the past year, I have honed my skills in {skill_cluster}. {proof_line} "
                f"I would be grateful for any opportunity to intern, job-shadow, or assist with a project at {company.company_name} in a way that is appropriate for a high school student.\n\n"
                "Thank you for considering my request. I would love to discuss any possible opportunities or learn about your recommended pathways for students interested in this field. "
                "I have attached my résumé and can provide references upon request.\n\n"
                "Sincerely,\n"
                f"{PROFILE['name']}\n"
                f"{PROFILE['email']}\n"
                f"{PROFILE['phone']}"
            )
        else:
            subject = "Quick question from a local IB senior"
            body = (
                f"Hello {greeting},\n\n"
                f"My name is {PROFILE['name']}, and I am a senior at {PROFILE['school']} in {PROFILE['location']} in the {PROFILE['program']}, interested in {track_phrase}.\n\n"
                f"{company_sentence}\n\n"
                f"I have experience with {skill_cluster} and recently {proof_line.lower()} "
                "Would you be open to a brief conversation, or is there someone on your team you would recommend I contact about shadowing or a small project-based opportunity this summer?\n\n"
                "Thank you for your time. I have attached my résumé and can provide references upon request.\n\n"
                "Sincerely,\n"
                f"{PROFILE['name']}\n"
                f"{PROFILE['email']}\n"
                f"{PROFILE['phone']}"
            )

        return EmailDraft(subject=subject, body=body)

    def _validate_email_draft(self, body: str, company_name: str) -> bool:
        if not re.search(r"^Hello ", body, flags=re.M):
            return False
        if body.count("I was interested") + body.count("I noticed") < 1:
            return False
        if company_name not in body:
            return False
        if len(body.split()) > 240:
            return False
        # Limit extra claims via simple proper noun count heuristic.
        proper_nouns = re.findall(r"\b[A-Z][a-z]+\b", body)
        if len(proper_nouns) > 45:
            return False
        return True

    # ---------- Utilities ----------

    def _add_business_days(self, start: dt.date, days: int) -> dt.date:
        current = start
        added = 0
        while added < days:
            current += dt.timedelta(days=1)
            if current.weekday() < 5:
                added += 1
        return current

    def _normalize_url(self, url: str) -> str:
        url = (url or "").strip()
        if not url:
            return ""
        if not url.startswith(("http://", "https://")):
            url = "https://" + url
        p = urlparse(url)
        if not p.netloc:
            return ""
        return f"{p.scheme}://{p.netloc}"


def read_companies_csv(path: str) -> List[CompanyInput]:
    out = []
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            out.append(CompanyInput(
                company_name=row.get("company_name", "").strip(),
                website_url=row.get("website_url", "").strip(),
                location=row.get("location", "").strip(),
                industry_focus=row.get("industry_focus", "").strip(),
                track_target=row.get("track target", row.get("track_target", "")).strip(),
                size_bucket=row.get("size_bucket", "unknown").strip().lower(),
                approach_hint=row.get("approach_hint", "").strip(),
                known_contacts=row.get("known_contacts", "").strip(),
            ))
    return out


def run_daily_pipeline(companies: Iterable[CompanyInput], start_date: Optional[dt.date] = None) -> List[CompanyOutput]:
    engine = InternshipOutreachCopilot()
    results = []
    for c in companies:
        if not c.company_name or not c.website_url:
            continue
        results.append(engine.process_company(c, start_date=start_date))
    return results


def main() -> None:
    parser = argparse.ArgumentParser(description="Internship Outreach Copilot")
    parser.add_argument("--input", required=True, help="CSV of companies")
    parser.add_argument("--output", default="outreach_output.json", help="Output JSON path")
    args = parser.parse_args()

    companies = read_companies_csv(args.input)
    outputs = run_daily_pipeline(companies)
    payload = [asdict(o) for o in outputs]

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    print(f"Processed {len(outputs)} companies -> {args.output}")


if __name__ == "__main__":
    main()
