import * as cheerio from "cheerio";

export type Track = "ib" | "consulting" | "econ_research" | "data" | "general";
export type SizeBucket = "small" | "mid" | "large" | "unknown";
export type Region = "Richmond" | "VA" | "DC" | "other";

export interface CompanyRecord {
  company_id: string;
  company_name: string;
  website_url?: string;
  domain?: string;
  location_city?: string;
  location_state?: string;
  region?: Region;
  industry_focus?: string;
  track?: Track;
  size_bucket?: SizeBucket;
  high_school_eligible?: "yes" | "no" | "unknown";
  priority?: number;
  approach_hint?: string;
  status?: string;
  stage?: "initial" | "followup1" | "followup2" | "warm_intro" | "closed";
  do_not_contact?: boolean;
  cooldown_until?: string;
  followup1_date?: string;
  followup2_date?: string;
  next_action?: string;
  total_score?: number;
}

export interface ContactRecord {
  contact_id: string;
  company_id: string;
  name: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  location?: string;
  source?: string;
  authority_score?: number;
  reply_score?: number;
  fit_score?: number;
  final_score?: number;
  is_primary?: boolean;
  is_backup1?: boolean;
  is_backup2?: boolean;
  bounced?: boolean;
}

export interface ResearchItemRecord {
  research_id: string;
  company_id: string;
  fact: string;
  evidence_quote: string;
  source_url: string;
  source_id: string;
  category: "what_they_do" | "who_they_serve" | "geography" | "capability" | "values";
  usefulness: number;
  usable_in_email: boolean;
}

export interface DraftRecord {
  draft_id: string;
  company_id: string;
  contact_id: string;
  subject_options: string[];
  chosen_subject?: string;
  email_body: string;
  company_sentence_used: string;
  proof_line_used: string;
  validated: boolean;
  validation_errors?: string;
}

const TRACK_KEYWORDS: Record<Track, string[]> = {
  ib: ["investment banking", "m&a", "advisory", "capital markets", "valuation"],
  consulting: ["consulting", "transformation", "strategy", "digital", "implementation"],
  econ_research: ["economist", "research", "policy", "economic analysis"],
  data: ["analytics", "data science", "engineering", "bi", "machine learning"],
  general: [],
};

const PROOF_BY_TRACK: Record<Track, string> = {
  data: "I’ve built Python and SQL automations to streamline research and operational workflows.",
  consulting: "I interned with UVA Darden building internal tracking systems and improving operational workflows.",
  econ_research: "I completed a professor-advised research project analyzing economic and regulatory drivers in healthcare markets.",
  ib: "I’m building strong quantitative skills and I’m interested in how firms evaluate businesses and markets.",
  general: "I’ve built structured projects that combine analysis, writing, and execution.",
};

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

export function add_business_days(date: Date, n: number): Date {
  const result = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const d = result.getDay();
    if (d !== 0 && d !== 6) remaining -= 1;
  }
  return result;
}

export class AutomationEngine {
  import_spreadsheets(rows: Record<string, string>[]): CompanyRecord[] {
    return rows.map((row, idx) => ({
      company_id: row.company_id ?? `import-${idx + 1}`,
      company_name: row.company_name ?? row.company ?? "",
      website_url: row.website_url ?? row.website,
      location_city: row.location_city,
      location_state: row.location_state,
      industry_focus: row.industry_focus ?? row.industry,
      track: (row.track as Track) ?? "general",
      size_bucket: (row.size_bucket as SizeBucket) ?? "unknown",
      approach_hint: row.approach_hint,
      status: "not_started",
      stage: "initial",
      high_school_eligible: "unknown",
      do_not_contact: false,
    }));
  }

  normalize_companies(companies: CompanyRecord[]): CompanyRecord[] {
    return companies.map((company) => {
      const domain = company.website_url ? this.extractDomain(company.website_url) : company.domain;
      return { ...company, company_name: normalizeName(company.company_name), domain };
    });
  }

  dedupe_companies(companies: CompanyRecord[]): CompanyRecord[] {
    const byKey = new Map<string, CompanyRecord>();
    for (const company of companies) {
      const normalized = normalizeName(company.company_name);
      const key = company.domain
        ? `domain:${company.domain}`
        : `name:${normalized}|loc:${company.location_city ?? ""}-${company.location_state ?? ""}`;
      if (!byKey.has(key)) byKey.set(key, company);
    }
    return [...byKey.values()];
  }

  write_to_base44(companies: CompanyRecord[]): CompanyRecord[] {
    return companies;
  }

  classify_company(company: CompanyRecord, websiteText = ""): CompanyRecord {
    const text = `${company.industry_focus ?? ""} ${websiteText}`.toLowerCase();
    let track = company.track ?? "general";
    if (!company.track || company.track === "general") {
      for (const [candidate, keywords] of Object.entries(TRACK_KEYWORDS) as [Track, string[]][]) {
        if (keywords.some((keyword) => text.includes(keyword))) {
          track = candidate;
          break;
        }
      }
    }

    const location = `${company.location_city ?? ""} ${company.location_state ?? ""}`.toLowerCase();
    let region: Region = "other";
    if (/richmond|glen allen|virginia|\bva\b/.test(location)) region = location.includes("richmond") ? "Richmond" : "VA";
    if (location.includes("dc") || location.includes("district of columbia") || location.includes("washington")) region = "DC";

    return { ...company, track, region, high_school_eligible: company.high_school_eligible ?? "unknown" };
  }

  validate_email(email: string): boolean {
    return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email);
  }

  extract_emails_from_pages(pages: string[]): string[] {
    const found = new Set<string>();
    for (const page of pages) {
      for (const match of page.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) {
        found.add(match[0].toLowerCase());
      }
    }
    return [...found];
  }

  find_contacts(company: CompanyRecord, pages: string[]): ContactRecord[] {
    const emails = this.extract_emails_from_pages(pages).filter((e) => this.validate_email(e));
    return emails.map((email, idx) => ({
      contact_id: `${company.company_id}-contact-${idx + 1}`,
      company_id: company.company_id,
      name: email.split("@")[0].replace(/[._-]/g, " "),
      title: idx === 0 ? "Director" : "Team",
      email,
      source: "website",
    }));
  }

  rank_contacts(company: CompanyRecord, contacts: ContactRecord[]): ContactRecord[] {
    const size = company.size_bucket ?? "unknown";
    const ranked = contacts.map((contact) => {
      const title = (contact.title ?? "").toLowerCase();
      let authority = 25;
      if (size === "small" && /(founder|ceo|owner)/.test(title)) authority = 70;
      if (size === "small" && /(director|head)/.test(title)) authority = 50;
      if (size === "mid" && /director/.test(title)) authority = 60;
      if (size === "large" && /senior manager/.test(title)) authority = 55;
      if (/(campus|student|early career)/.test(title)) authority = Math.max(authority - 40, 0);
      if (size === "large" && /(ceo|chief)/.test(title)) authority = 0;

      let reply = 30;
      if (contact.location?.toLowerCase().includes("va")) reply += 15;
      if (company.region === "Richmond" || company.region === "VA") reply += 25;
      if (contact.email) reply += 10;
      if (/(manager|director|lead)/.test(title)) reply += 15;
      if (size === "large" && /(global|chief|partner)/.test(title)) reply -= 20;

      let fit = 20;
      if (company.track && TRACK_KEYWORDS[company.track].some((kw) => title.includes(kw.split(" ")[0]))) fit += 20;
      if (/(hr|recruiting|talent)/.test(title)) fit -= 10;

      const final = 0.5 * authority + 0.35 * reply + 0.15 * fit;
      return { ...contact, authority_score: authority, reply_score: reply, fit_score: fit, final_score: Number(final.toFixed(2)) };
    }).sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));

    return ranked.map((contact, index) => ({ ...contact, is_primary: index === 0, is_backup1: index === 1, is_backup2: index === 2 }));
  }

  async fetch_company_pages(company: CompanyRecord, fetcher: (url: string) => Promise<string>): Promise<Record<string, { url: string; text: string }>> {
    const url = company.website_url ?? "";
    const candidates = ["", "/about", "/careers", "/news", "/services", "/contact"];
    const pages: Record<string, { url: string; text: string }> = {};

    for (const path of candidates.slice(0, 6)) {
      const pageUrl = new URL(path || "/", url).toString();
      const html = await fetcher(pageUrl);
      const text = this.clean_extract_text(html);
      if (this.compute_quality_score(text) >= 2) {
        const key = path === "" ? "home" : path.replace("/", "") || "internal";
        pages[key] = { url: pageUrl, text };
      }
    }
    return pages;
  }

  clean_extract_text(html: string): string {
    const $ = cheerio.load(html);
    $("nav,footer,script,style,noscript,iframe").remove();
    const blocks = $("h1,h2,h3,p,li").map((_, el) => $(el).text().trim()).get().filter(Boolean);
    return blocks.join("\n");
  }

  compute_quality_score(text: string): number {
    const chars = text.length;
    const paragraphs = text.split(/\n+/).filter((p) => p.trim().length > 20).length;
    if (chars < 800 || paragraphs < 6) return 1;
    if (chars > 2000 && paragraphs > 10) return 5;
    return 3;
  }

  build_research_pack(company: CompanyRecord, pages: Record<string, { url: string; text: string }>): ResearchItemRecord[] {
    return this.extract_facts(pages, company.company_id).items;
  }

  extract_facts(pages_text_by_source: Record<string, { url: string; text: string }>, company_id: string): { items: ResearchItemRecord[]; confidence: "OK" | "LOW" } {
    const items: ResearchItemRecord[] = [];
    const categories: ResearchItemRecord["category"][] = ["what_they_do", "who_they_serve", "geography", "capability"];
    const sources = Object.entries(pages_text_by_source).slice(0, 4);

    sources.forEach(([source_id, page], idx) => {
      const sentence = page.text.split(/[.!?]\s/).find((s) => s.length > 40) ?? page.text.slice(0, 140);
      const quoteWords = sentence.split(/\s+/).slice(0, 10).join(" ");
      const useful = Math.max(3, Math.min(5, Math.floor(sentence.length / 35)));
      const category = categories[idx % categories.length];
      items.push({
        research_id: `${company_id}-research-${idx + 1}`,
        company_id,
        fact: sentence.trim() + (sentence.trim().endsWith(".") ? "" : "."),
        evidence_quote: quoteWords,
        source_url: page.url,
        source_id,
        category,
        usefulness: useful,
        usable_in_email: useful >= 3 && category !== "values",
      });
    });

    while (items.length < 4) {
      items.push({
        research_id: `${company_id}-research-${items.length + 1}`,
        company_id,
        fact: "The company describes its services and client support model on its site.",
        evidence_quote: "describes its services and client support",
        source_url: Object.values(pages_text_by_source)[0]?.url ?? "",
        source_id: "home",
        category: "capability",
        usefulness: 3,
        usable_in_email: true,
      });
    }

    const usableSources = new Set(items.filter((x) => x.usable_in_email).map((x) => x.source_url));
    const confidence = usableSources.size >= 2 ? "OK" : "LOW";
    return { items: items.slice(0, 4), confidence };
  }

  select_company_sentence(company: CompanyRecord, items: ResearchItemRecord[]): string {
    const preferred = items
      .filter((item) => item.usable_in_email && ["what_they_do", "capability", "who_they_serve", "geography"].includes(item.category))
      .sort((a, b) => b.usefulness - a.usefulness)[0];
    if (preferred) return preferred.fact;
    return `I was interested in the work your team does in ${company.industry_focus ?? "your field"}.`;
  }

  draft_email(company: CompanyRecord, contact: ContactRecord, company_sentence: string): DraftRecord {
    const proof = PROOF_BY_TRACK[company.track ?? "general"];
    const ask = company.size_bucket === "large"
      ? "Would you be open to a brief conversation and guidance on an appropriate high school path at your firm?"
      : company.size_bucket === "mid"
        ? "Would you be open to project support or shadowing this summer?"
        : "Would you be open to shadowing or small project-based help this summer?";

    const paragraphs = [
      `Hi ${contact.name}, I’m Sriya, a high school senior in Glen Allen, VA, and I’m reaching out to learn from your team.`,
      company_sentence,
      proof,
      `${ask} I can adapt quickly and contribute where your team needs support.`,
      "If you're not the right person, who would you recommend I contact?",
      "If you'd prefer I not follow up, I will respect that.",
    ];

    const email_body = paragraphs.join("\n\n");
    const subject_options = [
      `Student outreach - ${company.company_name}`,
      `Quick question for ${company.company_name}`,
      `Summer learning request`,
    ];

    return {
      draft_id: `${company.company_id}-draft-${contact.contact_id}`,
      company_id: company.company_id,
      contact_id: contact.contact_id,
      subject_options,
      chosen_subject: subject_options[0],
      email_body,
      company_sentence_used: company_sentence,
      proof_line_used: proof,
      validated: false,
    };
  }

  validate_email_draft(draft: DraftRecord, contactName: string, companyName: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const body = draft.email_body;
    const words = body.trim().split(/\s+/).length;
    if (words < 120 || words > 155) errors.push("word_count");

    const paragraphs = body.split(/\n\n/).filter((p) => p.trim().length > 0);
    if (paragraphs.length !== 6) errors.push("paragraph_count");

    const once = (needle: string, label: string) => {
      const count = body.split(needle).length - 1;
      if (count !== 1) errors.push(label);
    };
    once(draft.company_sentence_used, "company_sentence_count");
    once(draft.proof_line_used, "proof_line_count");
    once("If you're not the right person, who would you recommend I contact?", "routing_line_count");
    once("If you'd prefer I not follow up, I will respect that.", "opt_out_count");

    if (/\d/.test(body) && !/\d/.test(`${draft.company_sentence_used} ${draft.proof_line_used}`)) errors.push("digit_hallucination");

    const allowed = new Set([contactName, companyName, "IB", "Glen Allen", "VA", "Sriya"]);
    const nouns = body.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g) ?? [];
    const disallowed = nouns.filter((word) => ![...allowed].some((allowedWord) => word.startsWith(allowedWord)));
    if (disallowed.length > 0) errors.push("proper_noun_hallucination");

    return { valid: errors.length === 0, errors };
  }

  schedule_sequence(sent_date: Date): { followup1_date: Date; followup2_date: Date; cooldown_until: Date } {
    const followup1_date = add_business_days(sent_date, 5);
    const followup2_date = add_business_days(followup1_date, 10);
    const cooldown_until = new Date(sent_date);
    cooldown_until.setDate(cooldown_until.getDate() + 75);
    return { followup1_date, followup2_date, cooldown_until };
  }

  enforce_cooldown(company: CompanyRecord, now = new Date()): boolean {
    if (!company.cooldown_until) return true;
    return now >= new Date(company.cooldown_until);
  }

  compute_company_scores(companies: CompanyRecord[]): CompanyRecord[] {
    return companies.map((company) => {
      const fit = Math.min(35, (company.priority ?? 3) * 7);
      const yes = company.track === "general" ? 12 : 22;
      const ease = company.domain ? 12 : 6;
      let timing = 0;
      if (company.cooldown_until && new Date(company.cooldown_until) > new Date()) timing = -100;
      else if (company.status === "not_started") timing = 20;
      else if (company.stage === "followup1") timing = 10;
      const portfolio = company.region === "Richmond" ? 10 : 5;
      return { ...company, total_score: fit + yes + ease + timing + portfolio };
    });
  }

  select_daily_batches(companies: CompanyRecord[], max_initial = 10, max_followups = 10): Record<string, CompanyRecord[]> {
    const sorted = [...companies].sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0));
    return {
      send_today: sorted.filter((c) => c.next_action === "send_initial").slice(0, max_initial),
      followup_today: sorted.filter((c) => ["send_followup1", "send_followup2"].includes(c.next_action ?? "")).slice(0, max_followups),
      research_needed: sorted.filter((c) => c.next_action === "research_needed"),
      contact_needed: sorted.filter((c) => c.next_action === "contact_needed"),
    };
  }

  classify_reply(text: string): "positive" | "referral" | "apply_online" | "rejection" | "bounce" | "opt_out" | "no_response" {
    const t = text.toLowerCase();
    if (t.includes("undeliverable") || t.includes("bounce")) return "bounce";
    if (t.includes("do not contact") || t.includes("unsubscribe")) return "opt_out";
    if (t.includes("apply online")) return "apply_online";
    if (t.includes("reach out to") || t.includes("contact ")) return "referral";
    if (t.includes("not interested") || t.includes("no")) return "rejection";
    if (t.includes("yes") || t.includes("happy to chat")) return "positive";
    return "no_response";
  }

  apply_outcome(company: CompanyRecord, outcome: ReturnType<AutomationEngine["classify_reply"]>): CompanyRecord {
    if (outcome === "opt_out") return { ...company, do_not_contact: true, status: "blocked", next_action: "closed" };
    if (outcome === "referral") return { ...company, stage: "warm_intro", next_action: "send_initial" };
    if (outcome === "bounce") return { ...company, next_action: "contact_needed" };
    if (outcome === "positive") return { ...company, status: "replied" };
    return company;
  }

  compute_metrics(drafts: DraftRecord[], touchOutcomes: string[]): Record<string, number> {
    const sent = drafts.length || 1;
    const replies = touchOutcomes.filter((o) => ["replied_positive", "replied_neutral"].includes(o)).length;
    return { reply_rate: replies / sent };
  }

  optimize_templates(metrics: Record<string, number>): string {
    return metrics.reply_rate < 0.1 ? "use concise subject lines" : "keep current rotation";
  }

  async run_daily_pipeline(input: {
    companies: CompanyRecord[];
    pagesByCompany: Record<string, Record<string, { url: string; text: string }>>;
    contactsByCompany?: Record<string, ContactRecord[]>;
  }): Promise<{ drafts: DraftRecord[]; report: string }> {
    const scored = this.compute_company_scores(input.companies);
    const queue = this.select_daily_batches(scored);
    const drafts: DraftRecord[] = [];

    for (const company of queue.send_today) {
      if (!this.enforce_cooldown(company)) continue;
      const pages = input.pagesByCompany[company.company_id] ?? {};
      const facts = this.extract_facts(pages, company.company_id);
      if (facts.confidence !== "OK") continue;
      const sentence = this.select_company_sentence(company, facts.items);
      const contacts = this.rank_contacts(company, input.contactsByCompany?.[company.company_id] ?? []);
      const primary = contacts[0];
      if (!primary) continue;
      const draft = this.draft_email(company, primary, sentence);
      const validation = this.validate_email_draft(draft, primary.name, company.company_name);
      draft.validated = validation.valid;
      draft.validation_errors = validation.errors.join(",");
      drafts.push(draft);
    }

    const report = `send_today=${queue.send_today.length},followups=${queue.followup_today.length},drafts=${drafts.length}`;
    return { drafts, report };
  }

  private extractDomain(url: string): string | undefined {
    try {
      return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    } catch {
      return undefined;
    }
  }
}

export const automationEngine = new AutomationEngine();
