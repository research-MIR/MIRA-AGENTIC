import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowDown, AlertCircle, Wrench, BrainCircuit, FileText, Check, X, ImageIcon } from "lucide-react";
import { BitStudioJob } from "@/types/vto";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { SecureImageDisplay } from "./SecureImageDisplay";

const ImageCard = ({ title, url }: { title: string, url?: string }) => {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-semibold text-center text-muted-foreground">{title}</h4>
      <div className="aspect-square bg-muted rounded-md overflow-hidden">
        {url ? <SecureImageDisplay imageUrl={url} alt={title} /> : <div className="w-full h-full flex items-center justify-center"><ImageIcon className="h-6 w-6 text-muted-foreground/50" /></div>}
      </div>
    </div>
  );
};

interface FixHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: BitStudioJob | null;
}

export const FixHistoryModal = ({ isOpen, onClose, job }: FixHistoryModalProps) => {
  if (!isOpen || !job || !job.metadata?.fix_history) return null;

  const history = job.metadata.fix_history;
  const originalSourceImageUrl = job.metadata.source_image_url;
  const referenceImageUrl = job.metadata.reference_image_url;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Automated Fix History</DialogTitle>
          <DialogDescription>
            A detailed log of each automated attempt to fix this VTO generation.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] my-4 pr-4">
          <div className="space-y-4">
            {history.map((attempt: any, index: number) => {
              const sourceForThisAttempt = index === 0 
                ? originalSourceImageUrl 
                : history[index - 1]?.qa_report_used?.failed_image_url;

              return (
                <div key={index} className="space-y-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-lg flex items-center gap-2">
                        <Wrench className="h-5 w-5" />
                        Fix Attempt #{attempt.retry_number || index + 1}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-3 gap-2 mb-4">
                        <ImageCard title="Source for this Attempt" url={sourceForThisAttempt} />
                        <ImageCard title="Reference Garment" url={referenceImageUrl} />
                        <ImageCard title="Failed Result" url={attempt.qa_report_used?.failed_image_url} />
                      </div>
                      <Accordion type="multiple" className="w-full">
                        <AccordionItem value="qa-report">
                          <AccordionTrigger>
                            <div className="flex items-center gap-2">
                              <AlertCircle className="h-4 w-4 text-destructive" />
                              <span>QA Report Used</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="text-xs space-y-2">
                            <p><strong>Match:</strong> {attempt.qa_report_used?.report?.is_match ? <CheckCircle className="inline h-4 w-4 text-green-500"/> : <X className="inline h-4 w-4 text-destructive"/>}</p>
                            <p><strong>Reason:</strong> {attempt.qa_report_used?.report?.mismatch_reason || "N/A"}</p>
                            <p><strong>Suggestion:</strong> {attempt.qa_report_used?.report?.fix_suggestion || "N/A"}</p>
                          </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="gemini-input">
                          <AccordionTrigger>
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-blue-500" />
                              <span>Input to Planner AI</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <pre className="bg-muted p-2 rounded-md text-xs overflow-x-auto">
                              {attempt.gemini_input_prompt}
                            </pre>
                          </AccordionContent>
                        </AccordionItem>
                        <AccordionItem value="gemini-output">
                          <AccordionTrigger>
                             <div className="flex items-center gap-2">
                              <BrainCircuit className="h-4 w-4 text-purple-500" />
                              <span>Planner AI Output</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent>
                            <pre className="bg-muted p-2 rounded-md text-xs overflow-x-auto">
                              {JSON.stringify(attempt.parsed_plan, null, 2)}
                            </pre>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
                    </CardContent>
                  </Card>
                  
                  {index < history.length - 1 && (
                    <div className="flex justify-center">
                      <ArrowDown className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};