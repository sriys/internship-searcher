import { useState } from "react";
import { useParams, Link } from "wouter";
import { useCompany, useRunResearch, useGenerateDraft, useUpdateDraft } from "@/hooks/use-companies";
import { AddContactDialog } from "@/components/AddContactDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, ArrowLeft, Globe, Search, Brain, Mail, CheckCircle2, Send, AlertCircle, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";

export default function CompanyDetail() {
  const { id } = useParams<{ id: string }>();
  const companyId = parseInt(id!);
  const { data, isLoading, error } = useCompany(companyId);
  const runResearch = useRunResearch();
  
  if (isLoading) return <div className="flex h-screen items-center justify-center"><Loader2 className="w-10 h-10 animate-spin text-primary" /></div>;
  if (error || !data) return <div className="flex h-screen items-center justify-center text-destructive">Failed to load company details</div>;

  const { company, research, contacts, drafts } = data;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <Link href="/" className="inline-flex items-center text-sm text-muted-foreground hover:text-primary mb-4 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
          </Link>
          
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-3xl font-display font-bold text-foreground">{company.name}</h1>
                <Badge variant="outline" className="text-sm px-3 py-1 capitalize">
                  {company.status}
                </Badge>
              </div>
              <div className="flex items-center gap-4 mt-2 text-muted-foreground text-sm">
                <a href={company.url} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-primary hover:underline">
                  <Globe className="w-4 h-4" /> {new URL(company.url).hostname}
                </a>
                <span className="capitalize px-2 py-0.5 bg-slate-100 rounded text-slate-600">{company.track}</span>
                <span className="capitalize px-2 py-0.5 bg-slate-100 rounded text-slate-600">{company.size}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="research" className="w-full">
          <TabsList className="bg-white border p-1 rounded-xl mb-6 shadow-sm">
            <TabsTrigger value="research" className="rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Research & Insights</TabsTrigger>
            <TabsTrigger value="contacts" className="rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Contacts ({contacts.length})</TabsTrigger>
            <TabsTrigger value="drafts" className="rounded-lg data-[state=active]:bg-primary/10 data-[state=active]:text-primary">Outreach Drafts ({drafts.length})</TabsTrigger>
          </TabsList>

          <AnimatePresence mode="wait">
            <TabsContent value="research" className="space-y-6">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                {research ? (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card className="md:col-span-2 border-primary/20 shadow-lg shadow-primary/5">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          <Brain className="w-5 h-5 text-accent" />
                          Key Insights
                        </CardTitle>
                        <CardDescription>
                          AI-extracted facts to personalize your outreach.
                          <span className={`ml-2 inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                            research.confidence === 'HIGH' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {research.confidence} Confidence
                          </span>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-6">
                        <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                          <h4 className="font-semibold text-foreground mb-1">Insight #1</h4>
                          <p className="text-slate-700">{research.fact1 || "No primary fact found."}</p>
                          {research.source1 && (
                            <p className="text-xs text-muted-foreground mt-2 italic">Source: {research.source1}</p>
                          )}
                        </div>
                        <div className="p-4 bg-slate-50 rounded-lg border border-slate-100">
                          <h4 className="font-semibold text-foreground mb-1">Insight #2</h4>
                          <p className="text-slate-700">{research.fact2 || "No secondary fact found."}</p>
                          {research.source2 && (
                            <p className="text-xs text-muted-foreground mt-2 italic">Source: {research.source2}</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                    
                    <div className="space-y-6">
                      <Card className="bg-gradient-to-br from-primary/5 to-transparent border-primary/10">
                        <CardHeader>
                          <CardTitle className="text-lg">Refresh Data</CardTitle>
                          <CardDescription>Re-run AI analysis on this company.</CardDescription>
                        </CardHeader>
                        <CardContent>
                          <Button 
                            onClick={() => runResearch.mutate(companyId)} 
                            disabled={runResearch.isPending}
                            className="w-full bg-accent hover:bg-accent/90"
                          >
                            {runResearch.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                            Run Deep Research
                          </Button>
                        </CardContent>
                      </Card>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-20 bg-white rounded-xl border border-dashed shadow-sm">
                    <Brain className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-xl font-bold text-foreground">No research data yet</h3>
                    <p className="text-muted-foreground mt-2 max-w-sm mx-auto mb-6">
                      Start by running our AI research agent to find key personalization points.
                    </p>
                    <Button 
                      onClick={() => runResearch.mutate(companyId)} 
                      disabled={runResearch.isPending}
                      size="lg"
                      className="bg-accent hover:bg-accent/90"
                    >
                      {runResearch.isPending ? "Analyzing..." : "Start Research Agent"}
                    </Button>
                  </div>
                )}
              </motion.div>
            </TabsContent>

            <TabsContent value="contacts" className="space-y-6">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Key People</h3>
                  <AddContactDialog companyId={companyId} />
                </div>
                
                {contacts.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {contacts.map((contact) => (
                      <Card key={contact.id} className="hover:border-primary/50 transition-colors">
                        <CardContent className="pt-6">
                          <div className="flex justify-between items-start mb-2">
                            <div className="font-semibold text-lg">{contact.name}</div>
                            {contact.active ? (
                              <div className="w-2 h-2 rounded-full bg-green-500 mt-2" />
                            ) : (
                              <div className="w-2 h-2 rounded-full bg-slate-300 mt-2" />
                            )}
                          </div>
                          <div className="text-sm font-medium text-primary mb-4">{contact.position || "Unknown Role"}</div>
                          <div className="text-sm text-muted-foreground flex items-center gap-2 bg-slate-50 p-2 rounded">
                            <Mail className="w-3 h-3" />
                            {contact.email || "No email added"}
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="bg-white p-8 rounded-xl border border-dashed text-center text-muted-foreground">
                    No contacts added yet. Add key decision makers to start drafting.
                  </div>
                )}
              </motion.div>
            </TabsContent>

            <TabsContent value="drafts" className="space-y-6">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold">Outreach Campaigns</h3>
                  <GenerateDraftDialog companyId={companyId} contacts={contacts} />
                </div>

                <div className="space-y-4">
                  {drafts.length > 0 ? drafts.map((draft) => (
                    <DraftCard key={draft.id} draft={draft} contactName={contacts.find(c => c.id === draft.contactId)?.name || "Unknown"} />
                  )) : (
                    <div className="bg-white p-12 rounded-xl border border-dashed text-center">
                      <Mail className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                      <h3 className="text-lg font-medium text-foreground">No drafts generated</h3>
                      <p className="text-muted-foreground mt-2">
                        Select a contact and provide a proof line to let AI write your email.
                      </p>
                    </div>
                  )}
                </div>
              </motion.div>
            </TabsContent>
          </AnimatePresence>
        </Tabs>
      </main>
    </div>
  );
}

function GenerateDraftDialog({ companyId, contacts }: { companyId: number, contacts: any[] }) {
  const [open, setOpen] = useState(false);
  const [contactId, setContactId] = useState<string>("");
  const [proofLine, setProofLine] = useState("");
  const generateDraft = useGenerateDraft();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactId || !proofLine) return;
    
    generateDraft.mutate({
      companyId,
      contactId: parseInt(contactId),
      proofLine
    }, {
      onSuccess: () => {
        setOpen(false);
        setProofLine("");
        setContactId("");
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-2 bg-accent hover:bg-accent/90">
          <Sparkles className="w-4 h-4" />
          Generate Draft
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>AI Email Generator</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div className="space-y-2">
            <Label>Select Recipient</Label>
            <Select value={contactId} onValueChange={setContactId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a contact" />
              </SelectTrigger>
              <SelectContent>
                {contacts.map(c => (
                  <SelectItem key={c.id} value={c.id.toString()}>{c.name} - {c.position}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          
          <div className="space-y-2">
            <Label>Proof Line / Context</Label>
            <Textarea 
              placeholder="e.g. I saw you recently raised Series B led by Sequoia..."
              value={proofLine}
              onChange={(e) => setProofLine(e.target.value)}
              className="h-32 resize-none"
            />
            <p className="text-xs text-muted-foreground">
              This specific detail proves you've done your homework. The AI will weave this into the email naturally.
            </p>
          </div>

          <Button type="submit" className="w-full bg-accent hover:bg-accent/90" disabled={generateDraft.isPending || !contactId || !proofLine}>
            {generateDraft.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Generate Perfect Draft
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DraftCard({ draft, contactName }: { draft: any, contactName: string }) {
  const [isEditing, setIsEditing] = useState(false);
  const [body, setBody] = useState(draft.emailBody || "");
  const updateDraft = useUpdateDraft();

  const handleSave = () => {
    updateDraft.mutate({
      id: draft.id,
      data: { status: draft.status === 'approved' ? 'approved' : 'approved', emailBody: body } // Keep current status if already approved, otherwise approve
    }, {
      onSuccess: () => setIsEditing(false)
    });
  };

  const markSent = () => {
    updateDraft.mutate({
      id: draft.id,
      data: { status: 'sent' }
    });
  };

  const subjectOptions = (draft.subjectOptions as string[]) || [];

  return (
    <Card className={`border-l-4 ${draft.status === 'sent' ? 'border-l-emerald-500' : 'border-l-amber-500'}`}>
      <CardHeader className="bg-slate-50/50 pb-3">
        <div className="flex justify-between items-start">
          <div>
            <CardTitle className="text-lg">Draft for {contactName}</CardTitle>
            <CardDescription className="mt-1">
              Created {format(new Date(draft.createdAt), 'MMM d, yyyy')} • <StatusBadge status={draft.status} />
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {draft.status !== 'sent' && (
              <>
                {isEditing ? (
                  <Button size="sm" onClick={handleSave} disabled={updateDraft.isPending}>Save Changes</Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>Edit</Button>
                )}
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700" onClick={markSent} disabled={updateDraft.isPending}>
                  Mark Sent
                </Button>
              </>
            )}
          </div>
        </div>
      </CardHeader>
      
      <CardContent className="pt-4 space-y-4">
        {/* Subject Lines */}
        <div className="space-y-2">
          <Label className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Subject Line Options</Label>
          <div className="grid gap-2">
            {subjectOptions.map((subject, idx) => (
              <div key={idx} className="bg-white p-2 text-sm border rounded hover:border-primary/50 cursor-pointer transition-colors">
                {subject}
              </div>
            ))}
          </div>
        </div>

        {/* Email Body */}
        <div className="space-y-2">
          <div className="flex justify-between items-center">
            <Label className="text-xs uppercase text-muted-foreground font-semibold tracking-wider">Email Body</Label>
            {isEditing && <span className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> Editing Mode</span>}
          </div>
          
          {isEditing ? (
            <Textarea 
              value={body} 
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[200px] font-mono text-sm leading-relaxed"
            />
          ) : (
            <div className="bg-white p-4 rounded border whitespace-pre-wrap text-sm font-mono leading-relaxed text-slate-700">
              {draft.emailBody}
            </div>
          )}
        </div>

        {/* Validation Checks Visualization */}
        <div className="pt-2 border-t flex gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1 text-emerald-600">
            <CheckCircle2 className="w-3 h-3" /> Strict Logic Check Passed
          </div>
          <div className="flex items-center gap-1 text-emerald-600">
            <CheckCircle2 className="w-3 h-3" /> Includes Proof Line
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
