import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: "bg-slate-100 text-slate-700 border-slate-200",
    approved: "bg-blue-100 text-blue-700 border-blue-200",
    sent: "bg-emerald-100 text-emerald-700 border-emerald-200",
    cooldown: "bg-amber-100 text-amber-700 border-amber-200",
  };

  return (
    <Badge variant="outline" className={`${styles[status] || styles.draft} capitalize`}>
      {status}
    </Badge>
  );
}
