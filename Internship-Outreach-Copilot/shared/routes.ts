import { z } from 'zod';
import { insertCompanySchema, insertContactSchema, companies, contacts, research, outreachDrafts } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  companies: {
    list: {
      method: 'GET' as const,
      path: '/api/companies' as const,
      responses: {
        200: z.array(z.custom<typeof companies.$inferSelect>()),
      },
    },
    create: {
      method: 'POST' as const,
      path: '/api/companies' as const,
      input: insertCompanySchema,
      responses: {
        201: z.custom<typeof companies.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/companies/:id' as const,
      responses: {
        200: z.object({
          company: z.custom<typeof companies.$inferSelect>(),
          contacts: z.array(z.custom<typeof contacts.$inferSelect>()),
          research: z.custom<typeof research.$inferSelect>().nullable(),
          drafts: z.array(z.custom<typeof outreachDrafts.$inferSelect>()),
        }),
        404: errorSchemas.notFound,
      },
    },
    research: {
      method: 'POST' as const,
      path: '/api/companies/:id/research' as const,
      responses: {
        200: z.custom<typeof research.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
  },
  contacts: {
    create: {
      method: 'POST' as const,
      path: '/api/companies/:id/contacts' as const,
      input: insertContactSchema.omit({ companyId: true }),
      responses: {
        201: z.custom<typeof contacts.$inferSelect>(),
      }
    }
  },
  drafts: {
    generate: {
      method: 'POST' as const,
      path: '/api/drafts/generate' as const,
      input: z.object({
        companyId: z.number(),
        contactId: z.number(),
        proofLine: z.string(),
      }),
      responses: {
        201: z.custom<typeof outreachDrafts.$inferSelect>(),
        400: errorSchemas.validation,
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/drafts/:id' as const,
      input: z.object({
        status: z.enum(['approved', 'sent']),
        emailBody: z.string().optional(),
      }),
      responses: {
        200: z.custom<typeof outreachDrafts.$inferSelect>(),
      },
    }
  }
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
