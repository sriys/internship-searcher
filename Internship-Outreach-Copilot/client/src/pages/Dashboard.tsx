import { useState } from "react";
import { useCompanies } from "@/hooks/use-companies";
import { CreateCompanyDialog } from "@/components/CreateCompanyDialog";
import { CompanyCard } from "@/components/CompanyCard";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, Sparkles } from "lucide-react";

export default function Dashboard() {
  const { data: companies, isLoading, error } = useCompanies();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const filteredCompanies = companies?.filter(company => {
    const matchesSearch = company.name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || company.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-display font-bold text-foreground">Outreach Copilot</h1>
              <p className="text-muted-foreground mt-1">Manage your internship hunt with precision.</p>
            </div>
            <CreateCompanyDialog />
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in">
        {/* Stats / Overview */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground">Total Companies</h3>
            <p className="text-3xl font-bold mt-2">{companies?.length || 0}</p>
          </div>
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground">In Research</h3>
            <p className="text-3xl font-bold mt-2 text-blue-600">
              {companies?.filter(c => c.status === 'researching').length || 0}
            </p>
          </div>
          <div className="bg-white p-6 rounded-xl border shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground">Ready to Draft</h3>
            <p className="text-3xl font-bold mt-2 text-purple-600">
              {companies?.filter(c => c.status === 'researched').length || 0}
            </p>
          </div>
          <div className="bg-white p-6 rounded-xl border shadow-sm border-l-4 border-l-emerald-500">
            <h3 className="text-sm font-medium text-muted-foreground">Outreach Sent</h3>
            <p className="text-3xl font-bold mt-2 text-emerald-600">
              {companies?.filter(c => c.status === 'outreach').length || 0}
            </p>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8 items-center bg-white p-4 rounded-xl border shadow-sm">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search companies..." 
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
            />
          </div>
          <div className="w-full sm:w-[200px]">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="idle">Idle</SelectItem>
                <SelectItem value="researching">Researching</SelectItem>
                <SelectItem value="researched">Researched</SelectItem>
                <SelectItem value="drafting">Drafting</SelectItem>
                <SelectItem value="outreach">Outreach Sent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Loading / Error States */}
        {isLoading && (
          <div className="flex justify-center items-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-primary" />
          </div>
        )}

        {error && (
          <div className="text-center py-20 bg-red-50 rounded-xl border border-red-100">
            <h3 className="text-lg font-semibold text-red-700">Failed to load companies</h3>
            <p className="text-red-500">{error.message}</p>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !error && filteredCompanies?.length === 0 && (
          <div className="text-center py-20 bg-white rounded-xl border border-dashed">
            <div className="bg-primary/10 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-8 h-8 text-primary" />
            </div>
            <h3 className="text-xl font-bold text-foreground">No companies found</h3>
            <p className="text-muted-foreground mt-2 max-w-sm mx-auto">
              {search || statusFilter !== 'all' 
                ? "Try adjusting your filters to see more results." 
                : "Get started by adding your first target company."}
            </p>
          </div>
        )}

        {/* Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {filteredCompanies?.map((company) => (
            <CompanyCard key={company.id} company={company} />
          ))}
        </div>
      </main>
    </div>
  );
}
