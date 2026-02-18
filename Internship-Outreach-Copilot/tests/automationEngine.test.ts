import test from "node:test";
import assert from "node:assert/strict";
import { AutomationEngine, add_business_days } from "../server/automationEngine";

const engine = new AutomationEngine();

test("add_business_days skips weekend", () => {
  const friday = new Date("2026-02-20T00:00:00.000Z");
  const next = add_business_days(friday, 1);
  assert.equal(next.toISOString().slice(0, 10), "2026-02-23");
});

test("dedupe + normalize by domain first then name+location", () => {
  const normalized = engine.normalize_companies([
    { company_id: "1", company_name: "Acme, Inc.", website_url: "https://www.acme.com", location_city: "Richmond", location_state: "VA" },
    { company_id: "2", company_name: "ACME INC", website_url: "https://acme.com/about", location_city: "Richmond", location_state: "VA" },
    { company_id: "3", company_name: "Blue Oak", location_city: "DC", location_state: "DC" },
    { company_id: "4", company_name: "blue oak", location_city: "DC", location_state: "DC" },
  ]);

  const deduped = engine.dedupe_companies(normalized);
  assert.equal(deduped.length, 2);
});

test("validate_email_draft catches strict structure failures", () => {
  const draft = {
    draft_id: "d1",
    company_id: "c1",
    contact_id: "ct1",
    subject_options: ["a"],
    chosen_subject: "acme internship outreach",
    email_body: "Hi Alex\n\nToo short",
    company_sentence_used: "Acme supports clients in Virginia.",
    proof_line_used: "I’ve built Python and SQL automations to streamline research and operational workflows.",
    validated: false,
  };

  const result = engine.validate_email_draft(draft, "Alex", "Acme");
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("word_count"));
  assert.ok(result.errors.includes("paragraph_count"));
});

test("run_daily_pipeline generates initial and followup drafts", async () => {
  const companies = [
    {
      company_id: "comp-1",
      company_name: "Acme Advisory",
      website_url: "https://example.com",
      domain: "example.com",
      track: "consulting" as const,
      size_bucket: "small" as const,
      status: "not_started" as const,
      stage: "initial" as const,
      next_action: "send_initial" as const,
      region: "VA" as const,
    },
    {
      company_id: "comp-2",
      company_name: "Blue River Data",
      website_url: "https://example.org",
      domain: "example.org",
      track: "data" as const,
      size_bucket: "mid" as const,
      status: "sent" as const,
      stage: "followup1" as const,
      followup1_date: "2020-01-01",
      next_action: "send_followup1" as const,
      region: "VA" as const,
    },
  ];

  const pagesByCompany = {
    "comp-1": {
      home: { url: "https://example.com", text: "Acme Advisory provides strategy and implementation support for clients in Virginia and the mid-Atlantic region. The team works with leadership groups to improve workflows and operational performance with practical project execution and measurable outcomes." },
      about: { url: "https://example.com/about", text: "The company serves healthcare and finance organizations with structured project support and implementation planning built around client priorities and delivery cadence." },
    },
  };

  const contactsByCompany = {
    "comp-1": [{ contact_id: "ct-1", company_id: "comp-1", name: "Alex", title: "Director", email: "alex@example.com", source: "website" as const }],
    "comp-2": [{ contact_id: "ct-2", company_id: "comp-2", name: "Jordan", title: "Senior Manager", email: "jordan@example.org", source: "website" as const }],
  };

  const result = await engine.run_daily_pipeline({ companies, pagesByCompany, contactsByCompany });
  assert.equal(result.drafts.length, 1);
  assert.equal(result.followups.length, 1);
  assert.ok(result.reportCsv.includes("company_id,type,subject,validated"));
});
