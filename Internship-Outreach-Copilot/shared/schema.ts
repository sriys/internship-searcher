import { pgTable, text, serial, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { relations } from "drizzle-orm";

// === COMPANIES ===
export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull().unique(), // Restrict duplicate scraping
  track: text("track").notNull(), // ib/consulting/econ_research/data/general
  size: text("size").notNull(), // small/mid/large/unknown
  status: text("status").default("idle"), // idle, researching, researched, drafting, drafted, outreach
  createdAt: timestamp("created_at").defaultNow(),
  lastScrapedAt: timestamp("last_scraped_at"),
});

// === CONTACTS ===
export const contacts = pgTable("contacts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id),
  name: text("name").notNull(),
  email: text("email"),
  position: text("position"),
  active: boolean("active").default(true),
});

// === RESEARCH ===
export const research = pgTable("research", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id),
  confidence: text("confidence").notNull(), // HIGH, LOW
  
  // Storing the specific structured output required
  fact1: text("fact1"),
  source1: text("source1"),
  fact2: text("fact2"),
  source2: text("source2"),
  
  // Full raw data for debugging/display
  rawItems: jsonb("raw_items"), 
  
  createdAt: timestamp("created_at").defaultNow(),
});

// === OUTREACH DRAFTS ===
export const outreachDrafts = pgTable("outreach_drafts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companies.id),
  contactId: integer("contact_id").references(() => contacts.id),
  
  subjectOptions: jsonb("subject_options"), // Array of 3 strings
  emailBody: text("email_body"),
  
  proofLine: text("proof_line"), // The user-provided proof line used
  
  status: text("status").default("draft"), // draft, approved, sent, cooldown
  
  sentAt: timestamp("sent_at"),
  followup1Date: timestamp("followup1_date"),
  followup2Date: timestamp("followup2_date"),
  cooldownUntil: timestamp("cooldown_until"),
  
  createdAt: timestamp("created_at").defaultNow(),
});

// === RELATIONS ===
export const companiesRelations = relations(companies, ({ one, many }) => ({
  contacts: many(contacts),
  research: one(research, {
    fields: [companies.id],
    references: [research.companyId],
  }),
  drafts: many(outreachDrafts),
}));

export const contactsRelations = relations(contacts, ({ one, many }) => ({
  company: one(companies, {
    fields: [contacts.companyId],
    references: [companies.id],
  }),
  drafts: many(outreachDrafts),
}));

export const researchRelations = relations(research, ({ one }) => ({
  company: one(companies, {
    fields: [research.companyId],
    references: [companies.id],
  }),
}));

export const draftsRelations = relations(outreachDrafts, ({ one }) => ({
  company: one(companies, {
    fields: [outreachDrafts.companyId],
    references: [companies.id],
  }),
  contact: one(contacts, {
    fields: [outreachDrafts.contactId],
    references: [contacts.id],
  }),
}));

// === SCHEMAS ===
export const insertCompanySchema = createInsertSchema(companies).omit({ 
  id: true, 
  createdAt: true, 
  lastScrapedAt: true,
  status: true 
});

export const insertContactSchema = createInsertSchema(contacts).omit({ 
  id: true 
});

export const insertResearchSchema = createInsertSchema(research).omit({ 
  id: true, 
  createdAt: true 
});

export const insertDraftSchema = createInsertSchema(outreachDrafts).omit({ 
  id: true, 
  createdAt: true,
  sentAt: true,
  followup1Date: true,
  followup2Date: true,
  cooldownUntil: true
});

// === TYPES ===
export type Company = typeof companies.$inferSelect;
export type InsertCompany = z.infer<typeof insertCompanySchema>;

export type Contact = typeof contacts.$inferSelect;
export type InsertContact = z.infer<typeof insertContactSchema>;

export type Research = typeof research.$inferSelect;
export type InsertResearch = z.infer<typeof insertResearchSchema>;

export type OutreachDraft = typeof outreachDrafts.$inferSelect;
export type InsertDraft = z.infer<typeof insertDraftSchema>;
