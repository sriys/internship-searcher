import datetime as dt
import pathlib
import sys

sys.path.append(str(pathlib.Path(__file__).resolve().parents[1]))

from internship_copilot import CompanyInput, InternshipOutreachCopilot


def test_business_day_offsets():
    bot = InternshipOutreachCopilot()
    start = dt.date(2026, 1, 2)  # Friday
    assert bot._add_business_days(start, 1) == dt.date(2026, 1, 5)
    assert bot._add_business_days(start, 5) == dt.date(2026, 1, 9)


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
    contacts = bot._extract_contacts(company, {})
    scored = [bot._score_contact(c, company.track_target, company.size_bucket, company.location) for c in contacts]
    primary, secondary = bot._select_two_contacts(scored)
    assert primary is not None
    assert secondary is not None
    assert primary.email == "jane@example.com"


def test_generic_sentence_on_low_confidence():
    bot = InternshipOutreachCopilot()

    class FakeResearch:
        confidence = "Low"
        facts = []

    sentence = bot._build_company_sentence(research=FakeResearch(), industry_focus="finance")
    assert "finance" in sentence
