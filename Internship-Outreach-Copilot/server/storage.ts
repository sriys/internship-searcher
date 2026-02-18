import { db } from "./db";
import { 
  companies, contacts, research, outreachDrafts,
  type Company, type InsertCompany,
  type Contact, type InsertContact,
  type Research, type InsertResearch,
  type OutreachDraft, type InsertDraft
} from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // Companies
  getCompanies(): Promise<Company[]>;
  getCompany(id: number): Promise<Company | undefined>;
  createCompany(company: InsertCompany): Promise<Company>;
  updateCompanyStatus(id: number, status: string): Promise<Company>;
  
  // Contacts
  getContacts(companyId: number): Promise<Contact[]>;
  getContact(id: number): Promise<Contact | undefined>;
  createContact(contact: InsertContact): Promise<Contact>;
  
  // Research
  getResearch(companyId: number): Promise<Research | undefined>;
  createResearch(research: InsertResearch): Promise<Research>;
  
  // Drafts
  getDrafts(companyId: number): Promise<OutreachDraft[]>;
  getDraft(id: number): Promise<OutreachDraft | undefined>;
  createDraft(draft: InsertDraft): Promise<OutreachDraft>;
  updateDraft(id: number, updates: Partial<InsertDraft>): Promise<OutreachDraft>;
}

export class DatabaseStorage implements IStorage {
  async getCompanies(): Promise<Company[]> {
    return await db.select().from(companies).orderBy(desc(companies.createdAt));
  }

  async getCompany(id: number): Promise<Company | undefined> {
    const [company] = await db.select().from(companies).where(eq(companies.id, id));
    return company;
  }

  async createCompany(company: InsertCompany): Promise<Company> {
    const [newCompany] = await db.insert(companies).values(company).returning();
    return newCompany;
  }

  async updateCompanyStatus(id: number, status: string): Promise<Company> {
    const [updated] = await db.update(companies)
      .set({ status })
      .where(eq(companies.id, id))
      .returning();
    return updated;
  }

  async getContacts(companyId: number): Promise<Contact[]> {
    return await db.select().from(contacts).where(eq(contacts.companyId, companyId));
  }

  async getContact(id: number): Promise<Contact | undefined> {
    const [contact] = await db.select().from(contacts).where(eq(contacts.id, id));
    return contact;
  }

  async createContact(contact: InsertContact): Promise<Contact> {
    const [newContact] = await db.insert(contacts).values(contact).returning();
    return newContact;
  }

  async getResearch(companyId: number): Promise<Research | undefined> {
    // Return latest research
    const [res] = await db.select().from(research)
      .where(eq(research.companyId, companyId))
      .orderBy(desc(research.createdAt))
      .limit(1);
    return res;
  }

  async createResearch(item: InsertResearch): Promise<Research> {
    const [newResearch] = await db.insert(research).values(item).returning();
    return newResearch;
  }

  async getDrafts(companyId: number): Promise<OutreachDraft[]> {
    return await db.select().from(outreachDrafts)
      .where(eq(outreachDrafts.companyId, companyId))
      .orderBy(desc(outreachDrafts.createdAt));
  }
  
  async getDraft(id: number): Promise<OutreachDraft | undefined> {
    const [draft] = await db.select().from(outreachDrafts).where(eq(outreachDrafts.id, id));
    return draft;
  }

  async createDraft(draft: InsertDraft): Promise<OutreachDraft> {
    const [newDraft] = await db.insert(outreachDrafts).values(draft).returning();
    return newDraft;
  }

  async updateDraft(id: number, updates: Partial<InsertDraft>): Promise<OutreachDraft> {
    const [updated] = await db.update(outreachDrafts)
      .set(updates)
      .where(eq(outreachDrafts.id, id))
      .returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
