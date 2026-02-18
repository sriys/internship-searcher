import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";

export type Track = "ib" | "consulting" | "econ_research" | "data" | "general";
export type SizeBucket = "small" | "mid" | "large" | "unknown";
export type Region = "Richmond" | "VA" | "DC" | "other";
export type Stage = "initial" | "followup1" | "followup2" | "warm_intro" | "closed";

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
  status?: "not_started" | "drafted" | "sent" | "replied" | "closed" | "blocked";
  stage?: Stage;
  do_not_contact?: boolean;
  last_contact_date?: string;
  followup1_date?: string;
  followup2_date?: string;
  cooldown_until?: string;
  next_action?: "send_initial" | "send_followup1" | "send_followup2" | "research_needed" | "contact_needed" | "cooldown" | "closed" | "needs_review";
  total_score?: number;
  created_at?: string;
  updated_at?: string;
}

export interface ContactRecord {
  contact_id: string;
  company_id: string;
  name: string;
  title?: string;
  email?: string;
  linkedin_url?: string;
  location?: string;
  source?: "website" | "referral" | "spreadsheet" | "manual";
  authority_score?: number;
  reply_score?: number;
  fit_score?: number;
  final_score?: number;
  is_primary?: boolean;
  is_backup1?: boolean;
  is_backup2?: boolean;
  last_emailed_date?: string;
  bounced?: boolean;
}

export interface ResearchItemRecord {
  research_id: string;
  company_id: string;
  fact: string;
  evidence_quote: string;
  source_url: string;
  source_id: "home" | "about" | "careers" | "news" | "services" | "internal";
  category: "what_they_do" | "who_they_serve" | "geography" | "capability" | "values";
  usefulness: number;
  usable_in_email: boolean;
  fetched_at?: string;
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
  created_at?: string;
}

export interface FetchCacheRecord {
  url: string;
  domain: string;
  fetched_at: number;
  cleaned_text: string;
  status_code: number;
  quality_score: number;
}

export interface TouchpointRecord {
  touch_id: string;
  company_id: string;
  contact_id: string;
  type: "initial" | "followup1" | "followup2" | "warm_intro";
  date: string;
  outcome: "no_response" | "replied_positive" | "replied_neutral" | "replied_negative" | "referral" | "bounce" | "apply_online" | "opt_out";
  notes?: string;
}

const TRACK_KEYWORDS: Record<Exclude<Track, "general">, string[]> = {
  ib: ["investment banking", "m&a", "advisory", "capital markets", "valuation"],
  consulting: ["consulting", "transformation", "strategy", "digital", "implementation"],
  econ_research: ["economist", "research", "policy", "economic analysis"],
  data: ["analytics", "data science", "engineering", "bi", "machine learning"],
};

const PROOF_BY_TRACK: Record<Track, string> = {
  data: "I’ve built Python and SQL automations to streamline research and operational workflows.",
  consulting: "I interned with UVA Darden building internal tracking systems and improving operational workflows.",
  econ_research: "I completed a professor-advised research project analyzing economic and regulatory drivers in healthcare markets.",
  ib: "I’m building strong quantitative skills and I’m interested in how firms evaluate businesses and markets.",
  general: "I’ve built structured projects that combine analysis, writing, and execution.",
};

const ROUTING_LINE = "If you're not the right person, who would you recommend I contact?";
const OPT_OUT_LINE = "If you'd prefer I not follow up, I will respect that.";
const DAY_MS = 86_400_000;

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

export function add_business_days(date: Date, n: number): Date {
  const result = new Date(date);
  let remaining = n;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

export class AutomationEngine {
  private fetchCache = new Map<string, FetchCacheRecord>();
  private lastRequestAtByDomain = new Map<string, number>();

  import_spreadsheets(files: string[]): CompanyRecord[] {
    const rows: CompanyRecord[] = [];
    files.forEach((filePath, fileIndex) => {
      const absolute = path.resolve(filePath);
      if (!fs.existsSync(absolute)) return;
      const workbook = XLSX.readFile(absolute);
      workbook.SheetNames.forEach((sheetName) => {
        const sheet = workbook.Sheets[sheetName];
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, string | number | undefined>>(sheet, { defval: "" });
        jsonRows.forEach((row, rowIndex) => {
          const companyName = String(row.company_name ?? row.Company ?? row.company ?? "").trim();
          if (!companyName) return;
          rows.push({
            company_id: String(row.company_id ?? `import-${fileIndex + 1}-${sheetName}-${rowIndex + 1}`),
            company_name: companyName,
            website_url: String(row.website_url ?? row.website ?? "").trim() || undefined,
            location_city: String(row.location_city ?? row.city ?? "").trim() || undefined,
            location_state: String(row.location_state ?? row.state ?? "").trim() || undefined,
            industry_focus: String(row.industry_focus ?? row.industry ?? row.category ?? "").trim() || undefined,
            track: (String(row.track ?? "").trim().toLowerCase() as Track) || "general",
            size_bucket: (String(row.size_bucket ?? row.size ?? "").trim().toLowerCase() as SizeBucket) || "unknown",
            approach_hint: String(row.approach_hint ?? "").trim() || undefined,
            status: "not_started",
            stage: "initial",
            high_school_eligible: "unknown",
            do_not_contact: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        });
      });
    });
    return rows;
  }

  normalize_companies(companies: CompanyRecord[]): CompanyRecord[] {
    return companies.map((company) => ({
      ...company,
      company_name: normalizeName(company.company_name),
      domain: company.website_url ? this.extractDomain(company.website_url) : company.domain,
      updated_at: new Date().toISOString(),
    }));
  }

  dedupe_companies(companies: CompanyRecord[]): CompanyRecord[] {
    const deduped = new Map<string, CompanyRecord>();
    for (const company of companies) {
      const byDomainKey = company.domain ? `domain:${company.domain}` : "";
      const byNameLocationKey = `name:${normalizeName(company.company_name)}|${(company.location_city ?? "").toLowerCase()}|${(company.location_state ?? "").toLowerCase()}`;
      const key = byDomainKey || byNameLocationKey;
      if (!deduped.has(key)) deduped.set(key, company);
    }
    return [...deduped.values()];
  }

  write_to_base44<T>(rows: T[], writer?: (payload: T[]) => Promise<void>): Promise<T[]> {
    if (!writer) return Promise.resolve(rows);
    return writer(rows).then(() => rows);
  }

  classify_company(company: CompanyRecord, websiteText = ""): CompanyRecord {
    const text = `${company.industry_focus ?? ""} ${websiteText}`.toLowerCase();
    let track = company.track ?? "general";
    if (!track || track === "general") {
      for (const [candidate, keywords] of Object.entries(TRACK_KEYWORDS) as [Exclude<Track, "general">, string[]][]) {
        if (keywords.some((keyword) => text.includes(keyword))) {
          track = candidate;
          break;
        }
      }
    }

    let size = company.size_bucket ?? "unknown";
    if (size === "unknown") {
      const employeeMatch = text.match(/(\d{1,6})\s*employees?/i);
      if (employeeMatch) {
        const count = Number(employeeMatch[1]);
        if (count > 0 && count <= 100) size = "small";
        else if (count <= 1000) size = "mid";
        else size = "large";
      }
    }

    const location = `${company.location_city ?? ""} ${company.location_state ?? ""}`.toLowerCase();
    let region: Region = "other";
    if (/richmond|glen allen/.test(location)) region = "Richmond";
    else if (/\bva\b|virginia/.test(location)) region = "VA";
    if (/\bdc\b|district of columbia|washington/.test(location)) region = "DC";

    return {
      ...company,
      track,
      size_bucket: size,
      region,
      high_school_eligible: company.high_school_eligible ?? "unknown",
      updated_at: new Date().toISOString(),
    };
  }

  validate_email(email: string): boolean {
    return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(email.trim());
  }

  extract_emails_from_pages(pages: string[]): string[] {
    const emails = new Set<string>();
    pages.forEach((content) => {
      for (const match of content.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi)) emails.add(match[0].toLowerCase());
    });
    return [...emails];
  }

  find_contacts(company: CompanyRecord, pagesByUrl: Record<string, string>, spreadsheetContact?: Partial<ContactRecord>): ContactRecord[] {
    const contacts: ContactRecord[] = [];

    if (spreadsheetContact?.email && this.validate_email(spreadsheetContact.email)) {
      contacts.push({
        contact_id: `${company.company_id}-spreadsheet`,
        company_id: company.company_id,
        name: spreadsheetContact.name ?? "Unknown",
        title: spreadsheetContact.title,
        email: spreadsheetContact.email.toLowerCase(),
        location: spreadsheetContact.location,
        source: "spreadsheet",
      });
    }

    const filteredPages = Object.entries(pagesByUrl)
      .filter(([url]) => /(team|leadership|contact|press|about)/i.test(url))
      .map(([, text]) => text);

    const discoveredEmails = this.extract_emails_from_pages(filteredPages);
    discoveredEmails.forEach((email, idx) => {
      if (!this.validate_email(email)) return;
      const local = email.split("@")[0].replace(/[._-]+/g, " ").trim();
      const inferredName = local.split(" ").map((token) => token.charAt(0).toUpperCase() + token.slice(1)).join(" ");
      contacts.push({
        contact_id: `${company.company_id}-web-${idx + 1}`,
        company_id: company.company_id,
        name: inferredName || "Team Contact",
        email,
        title: /careers|talent|recruit/.test(email) ? "Careers" : "Team",
        source: "website",
      });
    });

    if (contacts.length === 0 && company.domain) {
      contacts.push({
        contact_id: `${company.company_id}-fallback-general`,
        company_id: company.company_id,
        name: "General Inbox",
        email: `info@${company.domain}`,
        title: "General Inbox",
        source: "website",
      });
    }

    return this.uniqueContacts(contacts);
  }

  rank_contacts(company: CompanyRecord, contacts: ContactRecord[]): ContactRecord[] {
    const size = company.size_bucket ?? "unknown";
    const ranked = contacts.map((contact) => {
      const title = (contact.title ?? "").toLowerCase();
      let authority = this.baseAuthority(size, title);
      if (/(campus recruiting|early career|student programs)/.test(title)) authority -= 40;
      if (size === "large" && /(ceo|chief|c-suite|cfo|coo)/.test(title)) authority = 0;
      if (size === "large" && /(talent acquisition|recruiter)/.test(title)) authority -= 15;
      authority = Math.max(authority, 0);

      let reply = 0;
      if (company.region === "Richmond" || company.region === "VA" || company.region === "DC") reply += 25;
      if ((contact.location ?? "").toLowerCase().includes("va")) reply += 15;
      if (contact.email) reply += 10;
      if (/(manager|director|lead)/.test(title)) reply += 15;
      if (size === "large" && /(global|chief|partner)/.test(title)) reply -= 20;

      let fit = 0;
      const trackKeywords = company.track && company.track !== "general" ? TRACK_KEYWORDS[company.track] : [];
      if (trackKeywords.some((keyword) => title.includes(keyword.split(" ")[0]))) fit += 20;
      if (/(hr|talent|facilities|unrelated)/.test(title)) fit -= 10;

      const finalScore = Number((0.5 * authority + 0.35 * reply + 0.15 * fit).toFixed(2));
      return { ...contact, authority_score: authority, reply_score: reply, fit_score: fit, final_score: finalScore };
    }).sort((a, b) => (b.final_score ?? 0) - (a.final_score ?? 0));

    return ranked.map((contact, index) => ({
      ...contact,
      is_primary: index === 0,
      is_backup1: index === 1,
      is_backup2: index === 2,
    }));
  }

  async fetch_company_pages(company: CompanyRecord, fetcher?: (url: string) => Promise<{ status: number; html: string }>): Promise<Record<string, { url: string; text: string }>> {
    if (!company.website_url || !company.domain) return {};
    const base = new URL(company.website_url);
    const candidates: Array<[ResearchItemRecord["source_id"], string]> = [
      ["home", "/"],
      ["about", "/about"],
      ["careers", "/careers"],
      ["news", "/news"],
      ["services", "/services"],
      ["internal", "/contact"],
    ];

    const pages: Record<string, { url: string; text: string }> = {};
    for (const [sourceId, pathname] of candidates) {
      const url = new URL(pathname, base).toString();
      const hostname = new URL(url).hostname.toLowerCase();
      if (!(hostname === company.domain || hostname.endsWith(`.${company.domain}`))) continue;

      const cached = this.fetchCache.get(url);
      if (cached && Date.now() - cached.fetched_at < 7 * DAY_MS) {
        if (cached.quality_score >= 2) pages[sourceId] = { url, text: cached.cleaned_text };
        continue;
      }

      await this.delayForDomain(hostname);
      const result = await (fetcher
        ? fetcher(url)
        : this.defaultFetch(url));

      const cleaned = this.clean_extract_text(result.html);
      const quality = this.compute_quality_score(cleaned);
      this.fetchCache.set(url, {
        url,
        domain: company.domain,
        fetched_at: Date.now(),
        cleaned_text: cleaned,
        status_code: result.status,
        quality_score: quality,
      });
      if (quality >= 2) pages[sourceId] = { url, text: cleaned };
      if (Object.keys(pages).length >= 6) break;
    }
    return pages;
  }

  clean_extract_text(html: string): string {
    const $ = cheerio.load(html);
    $("nav,footer,script,style,noscript,iframe,form,svg").remove();
    const parts = $("h1,h2,h3,p,li")
      .map((_, el) => $(el).text().replace(/\s+/g, " ").trim())
      .get()
      .filter((t) => t.length > 0);
    return parts.join("\n");
  }

  compute_quality_score(text: string): number {
    const chars = text.length;
    const paragraphs = text.split(/\n+/).filter((p) => p.trim().length > 20).length;
    if (chars < 800 || paragraphs < 6) return 1;
    if (chars > 2200 && paragraphs >= 12) return 5;
    return 3;
  }

  build_research_pack(company: CompanyRecord, pages: Record<string, { url: string; text: string }>): { items: ResearchItemRecord[]; confidence: "OK" | "LOW" } {
    return this.extract_facts(pages, company.company_id);
  }

  extract_facts(pagesTextBySource: Record<string, { url: string; text: string }>, companyId: string): { items: ResearchItemRecord[]; confidence: "OK" | "LOW" } {
    const categories: ResearchItemRecord["category"][] = ["what_they_do", "who_they_serve", "geography", "capability"];
    const entries = Object.entries(pagesTextBySource).slice(0, 4);
    const items: ResearchItemRecord[] = entries.map(([sourceId, source], index) => {
      const sentences = source.text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 30);
      const selected = sentences[0] ?? "The company describes its services and client support on its website.";
      const quote = selected.split(/\s+/).slice(0, 12).join(" ");
      const usefulness = Math.max(1, Math.min(5, Math.floor(selected.length / 30)));
      const category = categories[index] ?? "values";
      return {
        research_id: `${companyId}-research-${index + 1}`,
        company_id: companyId,
        fact: selected.endsWith(".") ? selected : `${selected}.`,
        evidence_quote: quote,
        source_url: source.url,
        source_id: (sourceId as ResearchItemRecord["source_id"]) || "internal",
        category,
        usefulness,
        usable_in_email: category !== "values" && usefulness >= 3,
        fetched_at: new Date().toISOString(),
      };
    });

    while (items.length < 4) {
      const idx = items.length + 1;
      items.push({
        research_id: `${companyId}-research-${idx}`,
        company_id: companyId,
        fact: "The company outlines its capabilities and client support approach on its website.",
        evidence_quote: "outlines its capabilities and client support",
        source_url: entries[0]?.[1].url ?? "",
        source_id: "home",
        category: "capability",
        usefulness: 3,
        usable_in_email: true,
        fetched_at: new Date().toISOString(),
      });
    }

    const usable = items.filter((i) => i.usable_in_email);
    const uniqueSources = new Set(usable.map((i) => i.source_url));
    return { items: items.slice(0, 4), confidence: uniqueSources.size >= 2 ? "OK" : "LOW" };
  }

  select_company_sentence(company: CompanyRecord, items: ResearchItemRecord[]): string {
    const selected = items
      .filter((item) => item.usable_in_email && ["what_they_do", "capability", "who_they_serve", "geography"].includes(item.category))
      .sort((a, b) => b.usefulness - a.usefulness)[0];
    if (selected) return selected.fact;
    return `I was interested in the work your team does in ${company.industry_focus ?? "your field"}.`;
  }

  draft_email(company: CompanyRecord, contact: ContactRecord, companySentence: string): DraftRecord {
    const proofLine = PROOF_BY_TRACK[company.track ?? "general"];
    const ask = this.askBySize(company.size_bucket ?? "unknown");
    const paragraphs = [
      `Hi ${contact.name}, I am Sriya, a high school senior in Glen Allen, VA, and I am reaching out to learn from your team this summer.`,
      companySentence,
      proofLine,
      `${ask} I would be grateful for any way to contribute while learning from your team.`,
      ROUTING_LINE,
      OPT_OUT_LINE,
    ];

    const emailBody = this.ensureWordRange(paragraphs.join("\n\n"), 120, 155);
    return {
      draft_id: `${company.company_id}-${contact.contact_id}-${Date.now()}`,
      company_id: company.company_id,
      contact_id: contact.contact_id,
      subject_options: [
        `${company.company_name} internship outreach`,
        `Summer learning request for ${company.company_name}`,
        `Question from Sriya regarding ${company.company_name}`,
      ],
      chosen_subject: `${company.company_name} internship outreach`,
      email_body: emailBody,
      company_sentence_used: companySentence,
      proof_line_used: proofLine,
      validated: false,
      created_at: new Date().toISOString(),
    };
  }

  draft_followup_email(company: CompanyRecord, contact: ContactRecord, originalSubject: string): DraftRecord {
    const paragraphs = [
      `Hi ${contact.name}, I wanted to follow up on my earlier note about learning from ${company.company_name}.`,
      `Re: ${originalSubject}. I understand you may be busy, and I would appreciate any guidance when convenient.`,
      ROUTING_LINE,
      OPT_OUT_LINE,
    ];
    const emailBody = this.ensureWordRange(paragraphs.join("\n\n"), 70, 110);
    return {
      draft_id: `${company.company_id}-${contact.contact_id}-followup-${Date.now()}`,
      company_id: company.company_id,
      contact_id: contact.contact_id,
      subject_options: [`Re: ${originalSubject}`],
      chosen_subject: `Re: ${originalSubject}`,
      email_body: emailBody,
      company_sentence_used: "",
      proof_line_used: "",
      validated: false,
      created_at: new Date().toISOString(),
    };
  }

  validate_email_draft(draft: DraftRecord, contactName: string, companyName: string): { valid: boolean; errors: string[] } {
    const body = draft.email_body;
    const errors: string[] = [];
    const words = countWords(body);
    const paragraphs = body.split(/\n\n/).filter((p) => p.trim().length > 0);

    const isFollowup = draft.chosen_subject?.startsWith("Re:") ?? false;
    const expectedParagraphs = isFollowup ? 4 : 6;
    const minWords = isFollowup ? 70 : 120;
    const maxWords = isFollowup ? 110 : 155;

    if (words < minWords || words > maxWords) errors.push("word_count");
    if (paragraphs.length !== expectedParagraphs) errors.push("paragraph_count");

    if (!isFollowup) {
      this.assertSingle(body, draft.company_sentence_used, "company_sentence_count", errors);
      this.assertSingle(body, draft.proof_line_used, "proof_line_count", errors);
    }
    this.assertSingle(body, ROUTING_LINE, "routing_line_count", errors);
    this.assertSingle(body, OPT_OUT_LINE, "opt_out_count", errors);

    if (/\d/.test(body) && !/\d/.test(`${draft.company_sentence_used} ${draft.proof_line_used}`)) {
      errors.push("digit_hallucination");
    }

    const allowedProperNouns = [contactName, companyName, "IB", "Glen Allen", "VA", "Sriya"];
    const properNouns = body.match(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*/g) ?? [];
    const disallowed = properNouns.filter((noun) => !allowedProperNouns.some((allowed) => noun.startsWith(allowed)) && !["Hi", "Re"].includes(noun));
    if (disallowed.length > 0) errors.push("proper_noun_hallucination");

    return { valid: errors.length === 0, errors };
  }

  validate_or_regenerate_draft(draft: DraftRecord, company: CompanyRecord, contact: ContactRecord): DraftRecord {
    let validation = this.validate_email_draft(draft, contact.name, company.company_name);
    if (validation.valid) return { ...draft, validated: true, validation_errors: "" };

    let body = draft.email_body
      .replace(/\b\d+\b/g, "")
      .replace(/\s+/g, " ")
      .replace(/\s+\n/g, "\n")
      .trim();

    if (draft.chosen_subject?.startsWith("Re:")) {
      body = this.ensureWordRange(body, 70, 110);
    } else {
      body = this.ensureWordRange(body, 120, 155);
    }

    const regenerated = { ...draft, email_body: body };
    validation = this.validate_email_draft(regenerated, contact.name, company.company_name);
    if (!validation.valid) {
      return { ...regenerated, validated: false, validation_errors: validation.errors.join(",") };
    }

    return { ...regenerated, validated: true, validation_errors: "" };
  }

  schedule_sequence(company: CompanyRecord, sentDate: Date): CompanyRecord {
    const followup1 = add_business_days(sentDate, 5);
    const followup2 = add_business_days(followup1, 10);
    const cooldown = new Date(sentDate.getTime() + 75 * DAY_MS);
    return {
      ...company,
      stage: "followup1",
      followup1_date: isoDate(followup1),
      followup2_date: isoDate(followup2),
      cooldown_until: isoDate(cooldown),
      last_contact_date: isoDate(sentDate),
      updated_at: new Date().toISOString(),
    };
  }

  enforce_cooldown(company: CompanyRecord, now = new Date()): boolean {
    if (company.stage === "warm_intro") return true;
    if (!company.cooldown_until) return true;
    return now >= new Date(`${company.cooldown_until}T00:00:00.000Z`);
  }

  build_today_queue(companies: CompanyRecord, now = new Date()): CompanyRecord;
  build_today_queue(companies: CompanyRecord[], now?: Date): { send_today: CompanyRecord[]; followup_today: CompanyRecord[]; research_needed: CompanyRecord[]; contact_needed: CompanyRecord[] };
  build_today_queue(companies: CompanyRecord[] | CompanyRecord, now = new Date()) {
    if (!Array.isArray(companies)) return this.resolveNextAction(companies, now);
    const resolved = companies.map((c) => this.resolveNextAction(c, now));
    return this.select_daily_batches(this.compute_company_scores(resolved));
  }

  compute_company_scores(companies: CompanyRecord[]): CompanyRecord[] {
    const today = new Date();
    return companies.map((company) => {
      const fitScore = Math.min(35, (company.priority ?? 3) * 7);
      const yesScore = company.track === "general" ? 15 : 25;
      const easeScore = company.domain ? 15 : 8;
      const timingScore = this.computeTimingScore(company, today);
      const portfolioScore = company.region === "Richmond" || company.region === "VA" ? 10 : 6;
      return { ...company, total_score: fitScore + yesScore + easeScore + timingScore + portfolioScore };
    });
  }

  select_daily_batches(companies: CompanyRecord[], max_initial = 10, max_followups = 10): { send_today: CompanyRecord[]; followup_today: CompanyRecord[]; research_needed: CompanyRecord[]; contact_needed: CompanyRecord[] } {
    const sorted = [...companies].sort((a, b) => (b.total_score ?? 0) - (a.total_score ?? 0));
    return {
      send_today: sorted.filter((c) => c.next_action === "send_initial").slice(0, max_initial),
      followup_today: sorted.filter((c) => c.next_action === "send_followup1" || c.next_action === "send_followup2").slice(0, max_followups),
      research_needed: sorted.filter((c) => c.next_action === "research_needed"),
      contact_needed: sorted.filter((c) => c.next_action === "contact_needed"),
    };
  }

  classify_reply(text: string): "positive" | "referral" | "apply_online" | "rejection" | "bounce" | "opt_out" | "no_response" {
    const t = text.toLowerCase();
    if (/undeliverable|bounce|delivery failed/.test(t)) return "bounce";
    if (/unsubscribe|do not contact|remove me/.test(t)) return "opt_out";
    if (/apply online|please apply/.test(t)) return "apply_online";
    if (/reach out to|contact\s+/.test(t)) return "referral";
    if (/not interested|decline|cannot accommodate/.test(t)) return "rejection";
    if (/yes|happy to chat|let'?s talk|sounds good/.test(t)) return "positive";
    return "no_response";
  }

  apply_outcome(company: CompanyRecord, outcome: ReturnType<AutomationEngine["classify_reply"]>): CompanyRecord {
    if (outcome === "referral") return { ...company, stage: "warm_intro", next_action: "send_initial" };
    if (outcome === "apply_online") return { ...company, status: "sent", next_action: "closed" };
    if (outcome === "opt_out") return { ...company, do_not_contact: true, status: "blocked", next_action: "closed" };
    if (outcome === "bounce") return { ...company, next_action: "contact_needed" };
    if (outcome === "positive") return { ...company, status: "replied" };
    if (outcome === "rejection") return { ...company, status: "closed", next_action: "closed" };
    return company;
  }

  compute_metrics(drafts: DraftRecord[], touchpoints: TouchpointRecord[]): Record<string, number> {
    const sent = Math.max(drafts.length, 1);
    const replies = touchpoints.filter((t) => ["replied_positive", "replied_neutral"].includes(t.outcome)).length;
    const bounces = touchpoints.filter((t) => t.outcome === "bounce").length;
    return {
      reply_rate: replies / sent,
      bounce_rate: bounces / sent,
    };
  }

  optimize_templates(metrics: Record<string, number>): { subjectStyle: "concise" | "current"; askStyle: "shadowing" | "project_help" } {
    return {
      subjectStyle: metrics.reply_rate < 0.1 ? "concise" : "current",
      askStyle: metrics.reply_rate < 0.15 ? "shadowing" : "project_help",
    };
  }

  async run_daily_pipeline(input: {
    companies: CompanyRecord[];
    pagesByCompany?: Record<string, Record<string, { url: string; text: string }>>;
    contactsByCompany?: Record<string, ContactRecord[]>;
    fetcher?: (url: string) => Promise<{ status: number; html: string }>;
  }): Promise<{ drafts: DraftRecord[]; followups: DraftRecord[]; reportCsv: string; queue: ReturnType<AutomationEngine["select_daily_batches"]> }> {
    const normalized = this.normalize_companies(input.companies);
    const deduped = this.dedupe_companies(normalized);
    const classified = deduped.map((company) => this.classify_company(company));
    const queue = this.build_today_queue(this.compute_company_scores(classified));

    const drafts: DraftRecord[] = [];
    const followups: DraftRecord[] = [];

    for (const company of queue.send_today) {
      if (!this.enforce_cooldown(company)) continue;
      const pages = input.pagesByCompany?.[company.company_id] ?? await this.fetch_company_pages(company, input.fetcher);
      const research = this.build_research_pack(company, pages);
      if (research.confidence !== "OK") continue;
      const companySentence = this.select_company_sentence(company, research.items);
      const contacts = this.rank_contacts(company, input.contactsByCompany?.[company.company_id] ?? this.find_contacts(company, Object.fromEntries(Object.values(pages).map((v) => [v.url, v.text]))));
      const contact = contacts.find((c) => c.is_primary) ?? contacts[0];
      if (!contact) continue;

      const draft = this.validate_or_regenerate_draft(this.draft_email(company, contact, companySentence), company, contact);
      if (!draft.validated) {
        company.next_action = "needs_review";
        continue;
      }
      drafts.push(draft);
    }

    for (const company of queue.followup_today) {
      const contacts = this.rank_contacts(company, input.contactsByCompany?.[company.company_id] ?? []);
      const contact = contacts.find((c) => c.is_primary) ?? contacts[0];
      if (!contact) continue;
      const followup = this.validate_or_regenerate_draft(this.draft_followup_email(company, contact, `${company.company_name} internship outreach`), company, contact);
      if (followup.validated) followups.push(followup);
    }

    const lines = ["company_id,type,subject,validated"];
    drafts.forEach((d) => lines.push(`${d.company_id},initial,"${d.chosen_subject}",${d.validated}`));
    followups.forEach((d) => lines.push(`${d.company_id},followup,"${d.chosen_subject}",${d.validated}`));

    return {
      drafts,
      followups,
      reportCsv: lines.join("\n"),
      queue,
    };
  }

  private assertSingle(body: string, needle: string, code: string, errors: string[]) {
    if (!needle) {
      errors.push(code);
      return;
    }
    const count = body.split(needle).length - 1;
    if (count !== 1) errors.push(code);
  }

  private askBySize(size: SizeBucket): string {
    if (size === "large") return "Would you be open to a brief conversation and guidance on whether there is an appropriate path for a high school student?";
    if (size === "mid") return "Would you be open to project support or shadowing this summer?";
    return "Would you be open to shadowing or small project-based help this summer?";
  }

  private ensureWordRange(text: string, minWords: number, maxWords: number): string {
    const filler = "I am organized, responsive, and ready to help with practical work while learning.";
    let output = text;
    while (countWords(output) < minWords) {
      output = `${output}\n\n${filler}`;
    }
    const words = output.split(/\s+/);
    if (words.length > maxWords) output = words.slice(0, maxWords).join(" ");
    return output;
  }

  private baseAuthority(size: SizeBucket, title: string): number {
    if (size === "small") {
      if (/(founder|ceo|owner)/.test(title)) return 70;
      if (/coo/.test(title)) return 60;
      if (/(head|director)/.test(title)) return 50;
      if (/ops lead/.test(title)) return 40;
      if (/manager/.test(title)) return 35;
      return 25;
    }
    if (size === "mid") {
      if (/director/.test(title)) return 60;
      if (/vp/.test(title)) return 55;
      if (/senior manager/.test(title)) return 45;
      if (/office lead/.test(title)) return 40;
      return 25;
    }
    if (size === "large") {
      if (/senior manager/.test(title)) return 55;
      if (/director/.test(title)) return 50;
      if (/team lead/.test(title)) return 40;
      if (/office lead/.test(title)) return 30;
      return 20;
    }
    return 30;
  }

  private uniqueContacts(contacts: ContactRecord[]): ContactRecord[] {
    const seen = new Set<string>();
    return contacts.filter((c) => {
      const key = `${c.email ?? ""}|${c.name.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private resolveNextAction(company: CompanyRecord, now: Date): CompanyRecord {
    if (company.do_not_contact) return { ...company, next_action: "closed" };
    if (!this.enforce_cooldown(company, now)) return { ...company, next_action: "cooldown" };

    const followup1Due = company.followup1_date ? now >= new Date(`${company.followup1_date}T00:00:00.000Z`) : false;
    const followup2Due = company.followup2_date ? now >= new Date(`${company.followup2_date}T00:00:00.000Z`) : false;

    if (company.stage === "followup1" && followup1Due) return { ...company, next_action: "send_followup1" };
    if (company.stage === "followup2" && followup2Due) return { ...company, next_action: "send_followup2" };
    if (company.status === "not_started") return { ...company, next_action: "send_initial" };
    if (!company.domain || !company.website_url) return { ...company, next_action: "research_needed" };
    return { ...company, next_action: "contact_needed" };
  }

  private computeTimingScore(company: CompanyRecord, now: Date): number {
    if (!this.enforce_cooldown(company, now)) return -100;
    if (company.status === "not_started") return 20;

    if (company.stage === "followup1" && company.followup1_date) {
      const due = new Date(`${company.followup1_date}T00:00:00.000Z`);
      const deltaDays = Math.floor((due.getTime() - now.getTime()) / DAY_MS);
      if (deltaDays <= 0) return 10;
      if (deltaDays <= 2) return 5;
    }

    if (company.stage === "followup2" && company.followup2_date) {
      const due = new Date(`${company.followup2_date}T00:00:00.000Z`);
      const deltaDays = Math.floor((due.getTime() - now.getTime()) / DAY_MS);
      if (deltaDays <= 0) return 10;
      if (deltaDays <= 2) return 5;
      return -20;
    }

    return 0;
  }

  private async delayForDomain(domain: string): Promise<void> {
    const last = this.lastRequestAtByDomain.get(domain);
    const now = Date.now();
    if (last && now - last < 1500) {
      const wait = 1500 - (now - last);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastRequestAtByDomain.set(domain, Date.now());
  }

  private async defaultFetch(url: string): Promise<{ status: number; html: string }> {
    try {
      const response = await fetch(url, { headers: { "user-agent": "internship-copilot/1.0" }, signal: AbortSignal.timeout(15_000) });
      return { status: response.status, html: await response.text() };
    } catch {
      return { status: 599, html: "" };
    }
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
