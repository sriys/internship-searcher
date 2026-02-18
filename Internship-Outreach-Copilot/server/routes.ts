import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { api, errorSchemas } from "@shared/routes";
import { z } from "zod";
import { researcher, drafter } from "./services";
import { automationEngine } from "./automationEngine";
import { Research } from "@shared/schema";
import { seedDatabase } from "./seed";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  // Seed on startup
  seedDatabase().catch(console.error);
  
  // === COMPANIES ===
  app.get(api.companies.list.path, async (req, res) => {
    const companies = await storage.getCompanies();
    res.json(companies);
  });

  app.post(api.companies.create.path, async (req, res) => {
    try {
      const input = api.companies.create.input.parse(req.body);
      const company = await storage.createCompany(input);
      res.status(201).json(company);
    } catch (err) {
      if (err instanceof z.ZodError) {
        res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
        return;
      }
      // Handle unique constraint error
      res.status(500).json({ message: "Failed to create company" });
    }
  });

  app.get(api.companies.get.path, async (req, res) => {
    const id = Number(req.params.id);
    const company = await storage.getCompany(id);
    if (!company) {
      return res.status(404).json({ message: 'Company not found' });
    }
    
    const contacts = await storage.getContacts(id);
    const research = await storage.getResearch(id);
    const drafts = await storage.getDrafts(id);
    
    res.json({ company, contacts, research: research || null, drafts });
  });

  // === RESEARCH ===
  app.post(api.companies.research.path, async (req, res) => {
    const id = Number(req.params.id);
    const company = await storage.getCompany(id);
    if (!company) return res.status(404).json({ message: "Company not found" });

    // Update status
    await storage.updateCompanyStatus(id, "researching");

    // Run async research (but wait for it here to return result)
    // For a real app, might want to background this. 
    // Since scraping 6 pages + OpenAI takes time, user might wait ~30s.
    // We'll await it.
    
    const result = await researcher.conductResearch(company);
    
    // Store result
    const stored = await storage.createResearch({
      companyId: id,
      confidence: result.confidence,
      fact1: result.items[0]?.fact,
      source1: result.items[0]?.source_id,
      fact2: result.items[1]?.fact,
      source2: result.items[1]?.source_id,
      rawItems: result.items
    });

    await storage.updateCompanyStatus(id, "researched");
    
    res.json(stored);
  });

  // === CONTACTS ===
  app.post(api.contacts.create.path, async (req, res) => {
    const id = Number(req.params.id);
    try {
      const input = api.contacts.create.input.parse(req.body);
      const contact = await storage.createContact({ ...input, companyId: id });
      res.status(201).json(contact);
    } catch (err) {
      if (err instanceof z.ZodError) {
         return res.status(400).json({ message: err.message });
      }
      res.status(500).json({ message: "Error creating contact" });
    }
  });


  app.post('/api/pipeline/run', async (_req, res) => {
    const companies = await storage.getCompanies();
    const payload = companies.map((company) => ({
      company_id: String(company.id),
      company_name: company.name,
      website_url: company.url,
      track: company.track as any,
      size_bucket: company.size as any,
      status: company.status ?? 'not_started',
      next_action: 'send_initial',
    }));

    const runResult = await automationEngine.run_daily_pipeline({
      companies: payload,
      pagesByCompany: {},
      contactsByCompany: {},
    });

    res.json(runResult);
  });

  // === DRAFTS ===
  app.post(api.drafts.generate.path, async (req, res) => {
    try {
      const { companyId, contactId, proofLine } = api.drafts.generate.input.parse(req.body);
      
      const company = await storage.getCompany(companyId);
      const contact = await storage.getContact(contactId);
      const research = await storage.getResearch(companyId);

      if (!company || !contact || !research) {
        return res.status(404).json({ message: "Missing required data" });
      }

      if (research.confidence === 'LOW' || !research.fact1) {
        return res.status(400).json({ message: "Research confidence too low to generate draft." });
      }

      const generated = await drafter.generateDraft(contact, company, research.fact1, proofLine);
      
      if (!generated) {
        return res.status(400).json({ message: "Failed to generate valid draft (constraints validation failed)." });
      }

      const draft = await storage.createDraft({
        companyId,
        contactId,
        subjectOptions: generated.subject_options,
        emailBody: generated.email_body,
        proofLine: proofLine,
        status: 'draft'
      });

      await storage.updateCompanyStatus(companyId, "drafting");

      res.status(201).json(draft);

    } catch (err) {
       console.error(err);
       res.status(500).json({ message: "Generation failed" });
    }
  });

  app.patch(api.drafts.update.path, async (req, res) => {
     const id = Number(req.params.id);
     const { status, emailBody } = req.body; // simple body check
     
     const draft = await storage.updateDraft(id, { status, emailBody });
     res.json(draft);
  });

  return httpServer;
}
