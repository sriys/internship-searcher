import test from 'node:test';
import assert from 'node:assert/strict';
import { AutomationEngine, add_business_days } from '../server/automationEngine';

const engine = new AutomationEngine();

test('add_business_days skips weekend', () => {
  const friday = new Date('2026-02-20T00:00:00Z');
  const next = add_business_days(friday, 1);
  assert.equal(next.getUTCDay(), 1);
  assert.equal(next.toISOString().slice(0, 10), '2026-02-23');
});

test('validate_email_draft enforces strict structure', () => {
  const company_sentence = 'Your team provides analytics and advisory services for clients.';
  const proof = 'I’ve built Python and SQL automations to streamline research and operational workflows.';
  const body = [
    'Hi Alex, I am Sriya from Glen Allen, VA and I am exploring summer learning opportunities with your team.',
    company_sentence,
    proof,
    'Would you be open to shadowing or small project-based help this summer while I learn and contribute quickly where useful?',
    "If you're not the right person, who would you recommend I contact?",
    "If you'd prefer I not follow up, I will respect that.",
  ].join('\n\n');

  const draft = {
    draft_id: 'd1',
    company_id: 'c1',
    contact_id: 'ct1',
    subject_options: ['a', 'b', 'c'],
    email_body: body,
    company_sentence_used: company_sentence,
    proof_line_used: proof,
    validated: false,
  };

  const result = engine.validate_email_draft(draft, 'Alex', 'Acme');
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes('word_count'));
});

test('integration from facts to draft validation', async () => {
  const company = {
    company_id: 'comp-1',
    company_name: 'Acme Advisory',
    website_url: 'https://example.com',
    track: 'consulting' as const,
    size_bucket: 'small' as const,
    next_action: 'send_initial',
    status: 'not_started',
  };

  const pagesByCompany = {
    'comp-1': {
      home: {
        url: 'https://example.com',
        text: 'Acme Advisory provides strategy and implementation support for middle market organizations in Virginia. The team delivers analytics and operational improvement programs for finance and healthcare clients across the region with measurable support and ongoing advisory engagement.'
      },
      about: {
        url: 'https://example.com/about',
        text: 'Our advisors partner with leadership teams to improve decision systems, reporting, and process design through practical project execution.'
      }
    }
  };

  const contactsByCompany = {
    'comp-1': [
      {
        contact_id: 'ct-1',
        company_id: 'comp-1',
        name: 'Alex',
        title: 'Director',
        email: 'alex@example.com',
      }
    ]
  };

  const result = await engine.run_daily_pipeline({ companies: [company], pagesByCompany, contactsByCompany });
  assert.equal(result.drafts.length, 1);
  assert.equal(typeof result.report, 'string');
});
