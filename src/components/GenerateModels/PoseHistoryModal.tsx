import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { CheckCircle, XCircle, Copy } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { Input } from '@/components/ui/input';
import { showSuccess } from '@/utils/toast';

interface Pose {
  pose_prompt: string;
  prompt_context_for_gemini?: string;
  qa_history?: {
    timestamp: string;
    attempt: number;
    decision: 'pass' | 'fail';
    reasoning: string;
    failure_modes?: string[];
  }[];
  jobId?: string;
  comfyui_prompt_id?: string;
}

interface PoseHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  pose: Pose | null;
}

export const PoseHistoryModal = ({ isOpen, onClose, pose }: PoseHistoryModalProps) => {
  const { t } = useLanguage();

  if (!isOpen || !pose) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Analysis for: "{pose.pose_prompt}"</DialogTitle>
          <DialogDescription>
            A detailed log of the automated QA process and the prompts used for this pose.
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[60vh] my-4 pr-4">
          <div className="space-y-4">
            {pose.jobId && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Parent Job ID</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={pose.jobId} className="font-mono text-xs" />
                    <Button size="sm" onClick={() => { navigator.clipboard.writeText(pose.jobId!); showSuccess("Job ID copied!"); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {pose.comfyui_prompt_id && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Pose Generation ID</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Input readOnly value={pose.comfyui_prompt_id} className="font-mono text-xs" />
                    <Button size="sm" onClick={() => { navigator.clipboard.writeText(pose.comfyui_prompt_id!); showSuccess("Pose ID copied!"); }}>
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
            {pose.prompt_context_for_gemini && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Prompt Context Sent to AI</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="text-xs bg-muted p-2 rounded-md whitespace-pre-wrap font-mono">
                    {pose.prompt_context_for_gemini}
                  </pre>
                </CardContent>
              </Card>
            )}
            {pose.qa_history && pose.qa_history.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">QA History</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {pose.qa_history.map((entry, index) => (
                    <div key={index} className="p-3 border rounded-md">
                      <div className="flex justify-between items-center">
                        <h4 className="font-semibold">Attempt #{entry.attempt}</h4>
                        {entry.decision === 'pass' ? (
                          <Badge className="bg-green-600 hover:bg-green-700"><CheckCircle className="h-4 w-4 mr-1" /> Passed</Badge>
                        ) : (
                          <Badge variant="destructive"><XCircle className="h-4 w-4 mr-1" /> Failed</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-2 italic">"{entry.reasoning}"</p>
                      {entry.failure_modes && entry.failure_modes.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {entry.failure_modes.map(mode => (
                            <Badge key={mode} variant="secondary">{mode.replace(/_/g, ' ')}</Badge>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={onClose}>{t('done')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};