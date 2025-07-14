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
import { ArrowDown, AlertCircle, Wrench } from "lucide-react";
import { BitStudioJob } from "@/types/vto";

interface FixHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  job: BitStudioJob | null;
}

export const FixHistoryModal = ({ isOpen, onClose, job }: FixHistoryModalProps) => {
  if (!isOpen || !job || !job.metadata?.qa_history) return null;

  const history = job.metadata.qa_history;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Automated Fix History</DialogTitle>
          <DialogDescription>
            Review of the automated attempts to fix this VTO generation based on QA feedback.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] my-4 pr-4">
          <div className="space-y-4">
            {history.map((report: any, index: number) => (
              <div key={index} className="space-y-2">
                <Card className="bg-destructive/10 border-destructive">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertCircle className="h-5 w-5" />
                      Attempt {index + 1}: QA Failed
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <p><strong>Reason:</strong> {report.mismatch_reason || "No reason provided."}</p>
                    <p><strong>Suggestion:</strong> {report.fix_suggestion || "No suggestion provided."}</p>
                  </CardContent>
                </Card>
                
                {index < history.length && (
                  <div className="flex justify-center">
                    <ArrowDown className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
              </div>
            ))}
             {job.metadata.current_fix_plan && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Wrench className="h-5 w-5" />
                            Last Fix Attempt
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <p><strong>Action:</strong> {job.metadata.current_fix_plan.action}</p>
                        <p><strong>New Prompt:</strong></p>
                        <pre className="bg-muted p-2 rounded-md text-xs overflow-x-auto">
                            {job.metadata.current_fix_plan.parameters?.payload?.prompt || "No new prompt generated."}
                        </pre>
                    </CardContent>
                </Card>
             )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};