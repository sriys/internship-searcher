from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import re
import time
from dataclasses import asdict, dataclass, field
from html import unescape
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
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
    "what_they_do": ["provides", "offers", "specializes", "services", "solutions", "advisory", "practice"],
    "who_they_serve": ["clients", "customers", "institutions", "businesses", "organizations", "investors"],
    "capability": ["analytics", "strategy", "data", "research", "operations", "investment", "consulting", "modeling"],
    "geography": ["virginia", "richmond", "dc", "washington", "regional", "global"],
    "values": ["mission", "values", "integrity", "commitment", "culture", "purpose"],
}

GENERAL_INBOX_PREFIXES = ("info@", "careers@", "contact@")
PREFERRED_PATHS = ["/", "/about", "/services", "/what-we-do", "/careers", "/news", "/blog", "/press", "/insights", "/team", "/leadership", "/people", "/contact"]


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
class PageData:
    url: str
    html: str
    text: str


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
    def __init__(self, max_pages: int = 6, request_delay_s: float = 1.5, cache_days: int = 7):
        self.max_pages = max_pages
        self.request_delay_s = request_delay_s
        self.cache_days = cache_days
        self.cache_dir = Path(".cache/pages")
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def process_company(self, company: CompanyInput, start_date: Optional[dt.date] = None) -> CompanyOutput:
        start_date = start_date or dt.date.today()

        pages = self._crawl_company_pages(company.website_url)
        research = self._extract_research_pack(pages)
        company_sentence = self._build_company_sentence(research, company.industry_focus)

        contacts = self._extract_contacts(company, pages)
        scored = [self._score_contact(c, company.track_target, company.size_bucket, company.location) for c in contacts]
        primary, secondary = self._select_two_contacts(scored)

        contact_needed = len(contacts) == 0 or self._only_general_inbox(contacts)
        research_needed = research.confidence == "Low"

        email1 = self._build_email(company, primary, company_sentence, decision_maker=True) if primary else None
        email2 = self._build_email(company, secondary, company_sentence, decision_maker=False) if secondary else None

        if self._only_general_inbox(contacts):
            email2 = None

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
            followup_dates={"followup_1": followup_1.isoformat(), "followup_2": followup_2.isoformat()},
            cooldown_until=cooldown_until.isoformat(),
            flags=flags,
        )

    # ---------- Crawl + research ----------

    def _crawl_company_pages(self, website_url: str) -> List[PageData]:
        seed = self._normalize_url(website_url)
        if not seed:
            return []

        allowed_host = urlparse(seed).netloc
        queue = [urljoin(seed, path) for path in PREFERRED_PATHS]
        seen: set[str] = set()
        results: List[PageData] = []

        while queue and len(results) < self.max_pages:
            url = queue.pop(0)
            normalized = self._normalize_page_url(url)
            if not normalized or normalized in seen:
                continue
            seen.add(normalized)

            if urlparse(normalized).netloc != allowed_host:
                continue

            page = self._fetch_page(normalized)
            if not page:
                continue

            if self._is_content_rich(page.text):
                results.append(page)

            for link in self._extract_internal_links(page.html, page.url, allowed_host):
                if link not in seen and len(queue) < 40:
                    queue.append(link)

        return results

    def _fetch_page(self, url: str) -> Optional[PageData]:
        cached = self._read_cache(url)
        if cached:
            return cached

        try:
            req = Request(url, headers={"User-Agent": "Mozilla/5.0 InternshipOutreachBot/2.0"})
            with urlopen(req, timeout=15) as response:
                if "text/html" not in response.headers.get("Content-Type", ""):
                    return None
                html = response.read().decode("utf-8", errors="ignore")
        except Exception:
            return None
        finally:
            time.sleep(self.request_delay_s)

        text = self._clean_html_to_text(html)
        page = PageData(url=url, html=html, text=text)
        self._write_cache(url, page)
        return page

    def _clean_html_to_text(self, html: str) -> str:
        text = re.sub(r"(?is)<(script|style|noscript).*?>.*?</\\1>", " ", html)
        text = re.sub(r"(?is)<(nav|footer|header).*?>.*?</\\1>", " ", text)
        text = re.sub(r"(?s)<[^>]+>", " ", text)
        text = unescape(text)
        text = re.sub(r"\s+", " ", text)
        return text.strip()

    def _extract_internal_links(self, html: str, current_url: str, allowed_host: str) -> List[str]:
        hrefs = re.findall(r'href=["\']([^"\']+)["\']', html, flags=re.I)
        links: List[str] = []
        for href in hrefs:
            if href.startswith(("mailto:", "tel:", "javascript:", "#")):
                continue
            candidate = self._normalize_page_url(urljoin(current_url, href))
            if not candidate:
                continue
            if urlparse(candidate).netloc == allowed_host:
                links.append(candidate)
        return links

    def _extract_research_pack(self, pages: Sequence[PageData]) -> ResearchPack:
        items: List[FactItem] = []
        for page in pages:
            for sentence in self._split_sentences(page.text):
                category = self._classify_sentence(sentence)
                if not category:
                    continue
                usable = category != "values" and len(sentence.split()) >= 8
                items.append(
                    FactItem(
                        fact=sentence.strip(),
                        evidence_quote=self._extract_evidence(sentence),
                        source_url=page.url,
                        category=category,
                        usable_in_email=usable,
                    )
                )
                if len(items) >= 40:
                    break
            if len(items) >= 40:
                break

        deduped = self._dedupe_fact_items(items)[:4]
        usable_count = sum(1 for x in deduped if x.usable_in_email)
        non_values_usable = any(x.usable_in_email and x.category != "values" for x in deduped)
        confidence = "OK" if usable_count >= 2 and non_values_usable else "Low"
        return ResearchPack(facts=deduped, confidence=confidence)

    def _split_sentences(self, text: str) -> List[str]:
        chunks = re.split(r"(?<=[.!?])\s+", text)
        return [chunk.strip() for chunk in chunks if 40 <= len(chunk.strip()) <= 260]

    def _classify_sentence(self, sentence: str) -> Optional[str]:
        lower = sentence.lower()
        for category, keywords in CATEGORY_KEYWORDS.items():
            if any(keyword in lower for keyword in keywords):
                return category
        return None

    def _extract_evidence(self, sentence: str) -> str:
        words = sentence.split()
        if len(words) <= 18:
            return sentence
        return " ".join(words[:18])

    def _dedupe_fact_items(self, items: Sequence[FactItem]) -> List[FactItem]:
        seen = set()
        deduped = []
        for item in items:
            key = (item.category, item.fact[:120].lower())
            if key in seen:
                continue
            seen.add(key)
            deduped.append(item)
        return deduped

    def _build_company_sentence(self, research: ResearchPack, industry_focus: str) -> str:
        if research.confidence != "OK":
            return f"I was interested in the work your organization does in {industry_focus or 'your field'}."

        candidates = [fact for fact in research.facts if fact.usable_in_email and fact.category != "values"]
        if not candidates:
            return f"I was interested in the work your organization does in {industry_focus or 'your field'}."

        selected = candidates[0].fact.rstrip(".")
        return f"I was interested in your work and noticed that {selected[0].lower() + selected[1:]} .".replace(" .", ".")

    def _is_content_rich(self, text: str) -> bool:
        return len(text) >= 800 and len(re.findall(r"[.!?]", text)) >= 6

    # ---------- Contacts + scoring ----------

    def _extract_contacts(self, company: CompanyInput, pages: Sequence[PageData]) -> List[ContactCandidate]:
        candidates: List[ContactCandidate] = []

        if company.known_contacts:
            candidates.extend(self._parse_known_contacts(company.known_contacts, company.website_url, company.location))

        email_regex = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
        title_hint_regex = re.compile(
            r"(?i)(founder|ceo|owner|coo|cto|cfo|director|vp|head|manager|lead|operations|analyst|consultant|research)")

        for page in pages:
            for match in email_regex.finditer(page.html):
                email = match.group(0).lower()
                if any(existing.email == email for existing in candidates):
                    continue

                context_start = max(0, match.start() - 220)
                context_end = min(len(page.html), match.end() + 220)
                context = re.sub(r"(?s)<[^>]+>", " ", page.html[context_start:context_end])
                context = re.sub(r"\s+", " ", unescape(context))

                name = self._guess_name_from_context(context) or self._guess_identity_from_email(email)[0]
                title_match = title_hint_regex.search(context)
                title = title_match.group(1).title() if title_match else self._guess_identity_from_email(email)[1]
                candidates.append(
                    ContactCandidate(
                        name=name,
                        title=title,
                        email=email,
                        page_url_source=page.url,
                        location=company.location,
                    )
                )

        domain = urlparse(self._normalize_url(company.website_url) or "").netloc
        if domain:
            for prefix in GENERAL_INBOX_PREFIXES:
                fallback = f"{prefix}{domain}"
                if not any(existing.email == fallback for existing in candidates):
                    candidates.append(
                        ContactCandidate(
                            name="",
                            title="General Inbox",
                            email=fallback,
                            page_url_source=company.website_url,
                            location=company.location,
                        )
                    )

        return candidates

    def _guess_name_from_context(self, context: str) -> str:
        match = re.search(r"\b([A-Z][a-z]+\s+[A-Z][a-z]+)\b", context)
        return match.group(1) if match else ""

    def _parse_known_contacts(self, known: str, source_url: str, location: str) -> List[ContactCandidate]:
        parsed: List[ContactCandidate] = []
        for part in known.split(";"):
            bits = [token.strip() for token in part.split("|")]
            if len(bits) == 3 and "@" in bits[2]:
                parsed.append(ContactCandidate(name=bits[0], title=bits[1], email=bits[2].lower(), page_url_source=source_url, location=location))
        return parsed

    def _guess_identity_from_email(self, email: str) -> Tuple[str, str]:
        local = email.split("@", 1)[0]
        if any(local.startswith(prefix[:-1]) for prefix in GENERAL_INBOX_PREFIXES):
            return "", "General Inbox"
        parts = re.split(r"[._-]+", local)
        if len(parts) >= 2 and parts[0].isalpha() and parts[1].isalpha():
            return f"{parts[0].title()} {parts[1].title()}", ""
        return "", ""

    def _score_contact(self, contact: ContactCandidate, track: str, size_bucket: str, target_location: str) -> ScoredContact:
        authority = self._authority_score(contact.title, size_bucket)

        reply = 0.0
        if contact.email:
            reply += 15
        if contact.location and target_location and contact.location.lower() in target_location.lower():
            reply += 15
        if re.search(r"manager|director|lead", contact.title, flags=re.I):
            reply += 10
        if contact.title.lower() == "general inbox":
            reply += 5
        if size_bucket.lower() == "large" and re.search(r"global head|chief|partner", contact.title, flags=re.I):
            reply -= 15

        fit = 10 if self._title_matches_track(contact.title, track) else (-10 if contact.title else 0)
        final = 0.55 * authority + 0.35 * reply + 0.10 * fit
        return ScoredContact(**asdict(contact), authority=authority, reply_likelihood=reply, fit=fit, final_score=round(final, 2))

    def _authority_score(self, title: str, size_bucket: str) -> float:
        t = (title or "").lower()
        sb = size_bucket.lower()
        if sb == "small":
            if re.search(r"founder|ceo|owner", t):
                return 80
            if "coo" in t:
                return 70
            if re.search(r"head|director", t):
                return 60
            if "ops" in t:
                return 55
            if "manager" in t:
                return 45
        elif sb == "mid":
            if "director" in t:
                return 70
            if "vp" in t:
                return 65
            if "senior manager" in t:
                return 55
            if "office lead" in t:
                return 50
        elif sb == "large":
            if re.search(r"ceo|chief|cfo|coo|cto", t):
                return 0
            if "senior manager" in t:
                return 65
            if "director" in t:
                return 60
            if re.search(r"team lead|manager", t):
                return 55
            if "office lead" in t:
                return 45
        if "general inbox" in t:
            return 20
        return 40

    def _title_matches_track(self, title: str, track: str) -> bool:
        title_l = (title or "").lower()
        keywords = {
            "ib": ["investment", "bank", "finance", "capital", "advisory"],
            "consulting": ["consult", "strategy", "operations", "advisory"],
            "tech/data": ["data", "analytics", "engineering", "technology"],
            "econ research": ["econom", "research", "policy", "analysis"],
        }.get((track or "").lower(), [])
        return any(keyword in title_l for keyword in keywords)

    def _select_two_contacts(self, scored: Sequence[ScoredContact]) -> Tuple[Optional[ScoredContact], Optional[ScoredContact]]:
        if not scored:
            return None, None

        ordered = sorted(scored, key=lambda item: item.final_score, reverse=True)
        primary = ordered[0]

        secondary = None
        for candidate in ordered[1:]:
            if self._seniority_tier(candidate.title) != self._seniority_tier(primary.title):
                secondary = candidate
                break
        if not secondary and len(ordered) > 1:
            secondary = max(ordered[1:], key=lambda item: item.reply_likelihood)
        return primary, secondary

    def _seniority_tier(self, title: str) -> str:
        t = (title or "").lower()
        if re.search(r"ceo|founder|chief|owner|partner", t):
            return "exec"
        if re.search(r"vp|director|head", t):
            return "director"
        if re.search(r"manager|lead|ops", t):
            return "manager"
        if "general inbox" in t:
            return "inbox"
        return "unknown"

    def _only_general_inbox(self, contacts: Sequence[ContactCandidate]) -> bool:
        return bool(contacts) and all(contact.title.lower() == "general inbox" for contact in contacts)

    # ---------- Email generation ----------

    def _build_email(self, company: CompanyInput, contact: ScoredContact, company_sentence: str, decision_maker: bool) -> EmailDraft:
        track_phrase, skill_key, proof_key = TRACK_MAP.get((company.track_target or "").lower(), ("the field", "ops", "business_ops"))
        proof_line = PROOF_LINES[proof_key]
        skill_cluster = SKILL_CLUSTERS[skill_key]

        greeting = contact.name or contact.title or "there"

        if decision_maker:
            subject = "High School Senior Seeking Internship or Shadowing Opportunity"
            body = (
                f"Hello {greeting},\n\n"
                f"My name is {PROFILE['name']}, and I am a senior at {PROFILE['school']} in {PROFILE['location']} in the {PROFILE['program']}, with a strong interest in {track_phrase}.\n\n"
                f"{company_sentence}\n\n"
                f"Over the past year, I have honed my skills in {skill_cluster}. {proof_line} I would be grateful for any opportunity to intern, job-shadow, or assist with a project at {company.company_name} in a way that is appropriate for a high school student.\n\n"
                "Thank you for considering my request. I would love to discuss any possible opportunities or learn about your recommended pathways for students interested in this field. I have attached my résumé and can provide references upon request.\n\n"
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
                f"I have experience with {skill_cluster} and recently {proof_line.lower()} Would you be open to a brief conversation, or is there someone on your team you would recommend I contact about shadowing or a small project-based opportunity this summer?\n\n"
                "Thank you for your time. I have attached my résumé and can provide references upon request.\n\n"
                "Sincerely,\n"
                f"{PROFILE['name']}\n"
                f"{PROFILE['email']}\n"
                f"{PROFILE['phone']}"
            )

        return EmailDraft(subject=subject, body=body)

    def build_followup_email(self, previous_subject: str, contact_name_or_title: str, company_name: str, number: int) -> EmailDraft:
        subject = f"Re: {previous_subject}"
        if number == 1:
            body = (
                f"Hello {contact_name_or_title},\n\n"
                f"I wanted to follow up on my note from last week about opportunities to shadow or support a small project at {company_name}.\n\n"
                "If helpful, I can adapt to whatever is most appropriate for a high school student (short shadowing block, project assistance, or research support).\n\n"
                "Thank you again for your time.\n\n"
                "Sincerely,\n"
                f"{PROFILE['name']}"
            )
        else:
            body = (
                f"Hello {contact_name_or_title},\n\n"
                f"Quick final follow-up on my earlier outreach to {company_name}. If there is someone else I should contact for student shadowing or project opportunities, I would be very grateful for a referral.\n\n"
                "Thank you for your consideration.\n\n"
                "Sincerely,\n"
                f"{PROFILE['name']}"
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
            url = f"https://{url}"
        parsed = urlparse(url)
        if not parsed.netloc:
            return ""
        return f"{parsed.scheme}://{parsed.netloc}"

    def _normalize_page_url(self, url: str) -> str:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return ""
        return f"{parsed.scheme}://{parsed.netloc}{parsed.path}".rstrip("/") or f"{parsed.scheme}://{parsed.netloc}"

    def _cache_key(self, url: str) -> str:
        return hashlib.sha256(url.encode("utf-8")).hexdigest()

    def _read_cache(self, url: str) -> Optional[PageData]:
        path = self.cache_dir / f"{self._cache_key(url)}.json"
        if not path.exists():
            return None
        if dt.datetime.now() - dt.datetime.fromtimestamp(path.stat().st_mtime) > dt.timedelta(days=self.cache_days):
            return None
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return PageData(url=payload["url"], html=payload["html"], text=payload["text"])
        except Exception:
            return None

    def _write_cache(self, url: str, page: PageData) -> None:
        path = self.cache_dir / f"{self._cache_key(url)}.json"
        path.write_text(json.dumps(asdict(page)), encoding="utf-8")


def read_companies_csv(path: str) -> List[CompanyInput]:
    companies: List[CompanyInput] = []
    with open(path, newline="", encoding="utf-8") as handle:
        for row in csv.DictReader(handle):
            companies.append(
                CompanyInput(
                    company_name=row.get("company_name", "").strip(),
                    website_url=row.get("website_url", "").strip(),
                    location=row.get("location", "").strip(),
                    industry_focus=row.get("industry_focus", "").strip(),
                    track_target=row.get("track_target", row.get("track target", "")).strip(),
                    size_bucket=row.get("size_bucket", "unknown").strip().lower(),
                    approach_hint=row.get("approach_hint", "").strip(),
                    known_contacts=row.get("known_contacts", "").strip(),
                )
            )
    return companies


def run_daily_pipeline(companies: Iterable[CompanyInput], start_date: Optional[dt.date] = None) -> List[CompanyOutput]:
    engine = InternshipOutreachCopilot()
    outputs = []
    for company in companies:
        if not company.company_name or not company.website_url:
            continue
        outputs.append(engine.process_company(company, start_date=start_date))
    return outputs


def main() -> None:
    parser = argparse.ArgumentParser(description="Internship Outreach Copilot")
    parser.add_argument("--input", required=True, help="Input CSV path")
    parser.add_argument("--output", default="outreach_output.json", help="Output JSON path")
    args = parser.parse_args()

    companies = read_companies_csv(args.input)
    output = [asdict(item) for item in run_daily_pipeline(companies)]

    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(output, handle, indent=2)

    print(f"Processed {len(output)} companies -> {args.output}")


if __name__ == "__main__":
    main()
