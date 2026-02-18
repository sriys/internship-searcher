import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { Company, InsertCompany, InsertContact, InsertDraft, Contact, Research, OutreachDraft } from "@shared/schema";
import { useToast } from "@/hooks/use-toast";

// === COMPANIES ===

export function useCompanies() {
  return useQuery({
    queryKey: [api.companies.list.path],
    queryFn: async () => {
      const res = await fetch(api.companies.list.path);
      if (!res.ok) throw new Error("Failed to fetch companies");
      return api.companies.list.responses[200].parse(await res.json());
    },
  });
}

export function useCompany(id: number) {
  return useQuery({
    queryKey: [api.companies.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.companies.get.path, { id });
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch company details");
      return api.companies.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
  });
}

export function useCreateCompany() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: InsertCompany) => {
      const res = await fetch(api.companies.create.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to create company");
      }
      return api.companies.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.companies.list.path] });
      toast({ title: "Success", description: "Company added successfully" });
    },
    onError: (error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });
}

// === RESEARCH ===

export function useRunResearch() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (companyId: number) => {
      const url = buildUrl(api.companies.research.path, { id: companyId });
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) throw new Error("Failed to run research");
      return api.companies.research.responses[200].parse(await res.json());
    },
    onSuccess: (data, companyId) => {
      queryClient.invalidateQueries({ queryKey: [api.companies.get.path, companyId] });
      toast({ title: "Research Complete", description: "Company data updated with new insights." });
    },
    onError: (error) => {
      toast({ title: "Research Failed", description: error.message, variant: "destructive" });
    },
  });
}

// === CONTACTS ===

export function useCreateContact() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ companyId, data }: { companyId: number; data: Omit<InsertContact, "companyId"> }) => {
      const url = buildUrl(api.contacts.create.path, { id: companyId });
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to add contact");
      return api.contacts.create.responses[201].parse(await res.json());
    },
    onSuccess: (_, { companyId }) => {
      queryClient.invalidateQueries({ queryKey: [api.companies.get.path, companyId] });
      toast({ title: "Success", description: "Contact added successfully" });
    },
  });
}

// === DRAFTS ===

export function useGenerateDraft() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: { companyId: number; contactId: number; proofLine: string }) => {
      const res = await fetch(api.drafts.generate.path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to generate draft");
      return api.drafts.generate.responses[201].parse(await res.json());
    },
    onSuccess: (_, { companyId }) => {
      queryClient.invalidateQueries({ queryKey: [api.companies.get.path, companyId] });
      toast({ title: "Draft Generated", description: "AI has created a new outreach draft." });
    },
  });
}

export function useUpdateDraft() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { status: 'approved' | 'sent'; emailBody?: string } }) => {
      const url = buildUrl(api.drafts.update.path, { id });
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update draft");
      return api.drafts.update.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      // Invalidate the company view since drafts are shown there
      if (data.companyId) {
        queryClient.invalidateQueries({ queryKey: [api.companies.get.path, data.companyId] });
      }
      toast({ title: "Success", description: "Draft updated successfully." });
    },
  });
}
