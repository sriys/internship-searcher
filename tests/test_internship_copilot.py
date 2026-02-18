import datetime as dt
import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from internship_copilot import CompanyInput, InternshipOutreachCopilot, PageData


def test_business_day_offsets():
    bot = InternshipOutreachCopilot()
    start = dt.date(2026, 1, 2)  # Friday
    assert bot._add_business_days(start, 1) == dt.date(2026, 1, 5)
    assert bot._add_business_days(start, 5) == dt.date(2026, 1, 9)


def test_internal_link_extraction_domain_scoped():
    bot = InternshipOutreachCopilot()
    html = """
    <html><body>
      <a href='/about'>About</a>
      <a href='https://example.com/team'>Team</a>
      <a href='https://other.com/skip'>Skip</a>
      <a href='mailto:info@example.com'>Mail</a>
    </body></html>
    """
    links = bot._extract_internal_links(html, "https://example.com", "example.com")
    assert "https://example.com/about" in links
    assert "https://example.com/team" in links
    assert all("other.com" not in link for link in links)


def test_contact_scoring_and_selection():
    bot = InternshipOutreachCopilot()
    company = CompanyInput(
        company_name="Example Co",
        website_url="https://example.com",
        location="Richmond, VA",
        industry_focus="consulting",
        track_target="consulting",
        size_bucket="mid",
        known_contacts="Jane Doe|Director of Strategy|jane@example.com; Sam Lee|Operations Manager|sam@example.com",
    )
    contacts = bot._extract_contacts(company, [])
    scored = [bot._score_contact(c, company.track_target, company.size_bucket, company.location) for c in contacts]
    primary, secondary = bot._select_two_contacts(scored)
    assert primary is not None
    assert secondary is not None
    assert primary.email == "jane@example.com"


def test_low_confidence_sentence_fallback():
    bot = InternshipOutreachCopilot()
    sentence = bot._build_company_sentence(type("R", (), {"confidence": "Low", "facts": []})(), "finance")
    assert "finance" in sentence


def test_email_generation_with_only_inbox_contact():
    bot = InternshipOutreachCopilot()

    bot._crawl_company_pages = lambda _url: [
        PageData(
            url="https://example.com/contact",
            html="<html><body>Contact us at info@example.com</body></html>",
            text="Contact us at info@example.com for consulting services for businesses in Virginia. "
            "Our consulting solutions provide strategic support for clients across industries. "
            "We offer advisory and operations improvement for organizations seeking growth.",
        )
    ]

    output = bot.process_company(
        CompanyInput(
            company_name="Example Co",
            website_url="https://example.com",
            location="Richmond, VA",
            industry_focus="consulting",
            track_target="consulting",
            size_bucket="small",
        ),
        start_date=dt.date(2026, 1, 2),
    )

    assert output.email1 is not None
    assert output.email2 is None
    assert output.flags["contact_needed"] is True
