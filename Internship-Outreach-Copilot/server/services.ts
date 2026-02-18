import { openai } from "./replit_integrations/image/client"; // reusing client with OpenAI config
import * as cheerio from "cheerio";
import { Company, Contact, Research } from "@shared/schema";

// Helper types for Research
interface ResearchItem {
  fact: string;
  evidence: string;
  source_id: string;
  use_in_email: boolean;
}

interface ResearchResult {
  items: ResearchItem[];
}

// Helper types for Draft
interface DraftResult {
  subject_options: string[];
  email_body: string;
}

// === CONSTANTS ===
const MAX_PAGES = 6;
const MAX_CHARS = 18000;

// === RESEARCH SERVICE ===
export class ResearchService {
  async conductResearch(company: Company): Promise<{ items: ResearchItem[], confidence: 'HIGH' | 'LOW' }> {
    console.log(`[Research] Starting for ${company.name} (${company.url})`);
    
    // 1. Fetch Pages
    const pages = await this.fetchPages(company.url);
    const combinedText = this.processText(pages);
    
    if (combinedText.length < 500) {
      console.log("[Research] Not enough text found.");
      return { items: [], confidence: 'LOW' };
    }

    // 2. OpenAI Extraction
    const extractionPrompt = `You are a fact-extraction assistant. Use ONLY the provided page text. Do NOT add outside knowledge.

Create exactly 4 research items.

For each item output:
- fact: one specific sentence
- evidence: a 6–18 word quote copied verbatim from provided text
- source_id: page key (home/about/careers/news/services/etc.)
- use_in_email: true or false

Rules:
- Fact must be grounded in the evidence quote.
- No numbers, dates, deals, rankings, clients unless explicitly in evidence.
- Prefer describing what the company does, who they serve, where they operate, or what they value.
- Avoid vague marketing claims unless explicitly quoted.
- Output valid JSON:
{
  "items": [ ...4 objects... ]
}

PAGE TEXT:
${combinedText.slice(0, MAX_CHARS)}`;

    try {
      const response = await openai.chat.completions.create({
        model: "gpt-5.1",
        messages: [{ role: "user", content: extractionPrompt }],
        response_format: { type: "json_object" },
      });

      const result = JSON.parse(response.choices[0].message.content || "{}") as ResearchResult;
      const usableItems = result.items?.filter(i => i.use_in_email) || [];
      
      const confidence = usableItems.length >= 2 ? 'HIGH' : 'LOW';
      
      return { items: result.items || [], confidence };
    } catch (e) {
      console.error("[Research] Error calling OpenAI:", e);
      return { items: [], confidence: 'LOW' };
    }
  }

  private async fetchPages(baseUrl: string): Promise<Map<string, string>> {
    const pages = new Map<string, string>();
    const toVisit = [baseUrl];
    const visited = new Set<string>();

    // Basic BFS to find relevant links
    let attempt = 0;
    while (toVisit.length > 0 && visited.size < MAX_PAGES && attempt < 15) {
      attempt++;
      const url = toVisit.shift()!;
      if (visited.has(url)) continue;
      
      visited.add(url);
      
      try {
        console.log(`[Scraper] Fetching ${url}`);
        const html = await this.fetchHtml(url);
        if (!html) continue;
        
        const $ = cheerio.load(html);
        
        // Extract text for this page
        // Strip unwanted
        $('script, style, nav, footer, iframe, noscript').remove();
        const text = $('body').text().replace(/\s+/g, ' ').trim();
        
        // Identify page type
        let key = 'internal';
        const lowerUrl = url.toLowerCase();
        if (url === baseUrl || url === baseUrl + '/') key = 'home';
        else if (lowerUrl.includes('about')) key = 'about';
        else if (lowerUrl.includes('career') || lowerUrl.includes('job')) key = 'careers';
        else if (lowerUrl.includes('news') || lowerUrl.includes('blog') || lowerUrl.includes('press')) key = 'news';
        else if (lowerUrl.includes('service') || lowerUrl.includes('what-we-do')) key = 'services';
        
        pages.set(key, text);

        // Find links if we still need pages
        if (visited.size < MAX_PAGES) {
           $('a').each((_, el) => {
             const href = $(el).attr('href');
             if (href && !href.startsWith('#') && !href.startsWith('mailto')) {
               try {
                 const absolute = new URL(href, baseUrl).href;
                 if (absolute.startsWith(baseUrl) && !visited.has(absolute) && !toVisit.includes(absolute)) {
                   toVisit.push(absolute);
                 }
               } catch (e) {}
             }
           });
        }
      } catch (e) {
        console.error(`[Scraper] Failed to fetch ${url}`, e);
      }
    }
    return pages;
  }

  private async fetchHtml(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        },
        signal: AbortSignal.timeout(5000) // 5s timeout
      });
      if (!res.ok) return null;
      return await res.text();
    } catch (e) {
      return null;
    }
  }

  private processText(pages: Map<string, string>): string {
    let output = "";
    for (const [key, text] of pages) {
      output += `--- PAGE: ${key} ---\n${text.slice(0, 3000)}\n\n`;
    }
    return output;
  }
}

// === DRAFT SERVICE ===
export class DraftService {
  async generateDraft(
    contact: Contact, 
    company: Company, 
    fact: string, 
    proofLine: string
  ): Promise<DraftResult | null> {
    
    const prompt = `You write short cold emails. Use ONLY the inputs provided. Do NOT invent facts.

Write an email with EXACTLY 6 paragraphs. Each paragraph must be 1–2 sentences.
Total length: 120–155 words.

Inputs:
contact_name: ${contact.name}
company_name: ${company.name}
company_sentence: ${fact}
track: ${company.track}
company_size: ${company.size}
proof_line: ${proofLine}

Email Structure:
1) Greeting + who I am (high school senior in IB program in Glen Allen VA).
2) Include company_sentence exactly as written.
3) Include proof_line exactly as written.
4) Ask (based on company_size):
   - small/unknown: shadowing or small project-based opportunity
   - mid: project-based support or shadowing
   - large: brief conversation and guidance for high school path
5) Routing sentence EXACTLY:
   "If you're not the right person, who would you recommend I contact?"
6) Close with opt-out EXACTLY:
   "If you'd prefer I not follow up, I will respect that."

Return JSON:
{
  "subject_options": [3 short subject lines],
  "email_body": "full email"
}
No extra commentary.`;

    let attempt = 0;
    while (attempt < 3) { // Increased to 3
      attempt++;
      let retryPrompt = prompt;
      if (attempt > 1) {
         retryPrompt += "\n\nPREVIOUS ATTEMPT FAILED VALIDATION. ";
         if (attempt === 2) retryPrompt += "ENSURE WORD COUNT IS BETWEEN 120 AND 155.";
         if (attempt === 3) retryPrompt += "STRICTLY ADHERE TO WORD COUNT AND PARAGRAPH COUNT.";
      }

      try {
        const response = await openai.chat.completions.create({
          model: "gpt-5.1",
          messages: [{ role: "user", content: retryPrompt }],
          response_format: { type: "json_object" },
        });
        
        const result = JSON.parse(response.choices[0].message.content || "{}") as DraftResult;
        
        // Validate
        if (this.validate(result.email_body, fact, proofLine)) {
          return result;
        } else {
          console.log(`[Draft] Validation failed attempt ${attempt}`);
        }
      } catch (e) {
        console.error("[Draft] Error generating:", e);
      }
    }
    
    return null; // Failed validation
  }

  private validate(body: string, fact: string, proofLine: string): boolean {
    // 1. Word count 120-155
    const words = body.trim().split(/\s+/).length;
    if (words < 120 || words > 155) {
      console.log(`[Validation] Word count ${words} invalid`);
      return false;
    }

    // 2. 6 Paragraphs
    const paras = body.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    if (paras.length !== 6) {
      console.log(`[Validation] Para count ${paras.length} invalid`);
      return false;
    }

    // 3. Contains company_sentence exactly
    if (!body.includes(fact)) {
       console.log(`[Validation] Missing fact`);
       return false;
    }

    // 4. Contains proof_line exactly
    if (!body.includes(proofLine)) {
       console.log(`[Validation] Missing proof line`);
       return false;
    }

    // 5. Routing sentence match
    if (!body.includes("If you're not the right person, who would you recommend I contact?")) {
       console.log(`[Validation] Missing routing`);
       return false;
    }

    // 6. Opt-out match
    if (!body.includes("If you'd prefer I not follow up, I will respect that.")) {
       console.log(`[Validation] Missing opt-out`);
       return false;
    }

    return true;
  }
}

export const researcher = new ResearchService();
export const drafter = new DraftService();
