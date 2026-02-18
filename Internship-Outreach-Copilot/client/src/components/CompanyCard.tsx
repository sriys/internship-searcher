import { Link } from "wouter";
import { Company } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card";
import { Building2, ExternalLink, Calendar, Briefcase } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const statusColors: Record<string, string> = {
  idle: "bg-slate-100 text-slate-600 border-slate-200",
  researching: "bg-blue-100 text-blue-700 border-blue-200",
  researched: "bg-indigo-100 text-indigo-700 border-indigo-200",
  drafting: "bg-amber-100 text-amber-700 border-amber-200",
  drafted: "bg-purple-100 text-purple-700 border-purple-200",
  outreach: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export function CompanyCard({ company }: { company: Company }) {
  return (
    <Card className="h-full card-hover border-border/60 overflow-hidden bg-white/60">
      <CardHeader className="pb-3">
        <div className="flex justify-between items-start gap-2">
          <Link href={`/companies/${company.id}`} className="block group min-w-0 flex-1">
            <CardTitle className="text-xl font-bold truncate group-hover:text-primary transition-colors cursor-pointer">
              {company.name}
            </CardTitle>
          </Link>
          <Badge variant="outline" className={`${statusColors[company.status || "idle"]} capitalize shrink-0`}>
            {company.status}
          </Badge>
        </div>
        <a 
          href={company.url} 
          target="_blank" 
          rel="noreferrer" 
          className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1 w-fit"
        >
          {new URL(company.url).hostname} <ExternalLink className="w-3 h-3" />
        </a>
      </CardHeader>
      <Link href={`/companies/${company.id}`} className="block">
        <CardContent className="pb-3 text-sm text-muted-foreground space-y-2 cursor-pointer">
          <div className="flex items-center gap-2">
            <Briefcase className="w-4 h-4" />
            <span className="capitalize">{company.track?.replace('_', ' ')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4" />
            <span className="capitalize">{company.size} size</span>
          </div>
        </CardContent>
        <CardFooter className="pt-3 border-t bg-slate-50/50 text-xs text-muted-foreground flex justify-between cursor-pointer">
          <div className="flex items-center gap-1">
            <Calendar className="w-3 h-3" />
            Added {company.createdAt ? formatDistanceToNow(new Date(company.createdAt)) : 'recently'} ago
          </div>
        </CardFooter>
      </Link>
    </Card>
  );
}
