import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Trash2, Loader2 } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';

interface Job {
  id: string;
  original_prompt: string;
}

interface ManageChatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectName: string;
  jobs: Job[];
  onRemoveChat: (jobId: string) => Promise<void>;
  isRemoving: string | null;
}

export const ManageChatsModal = ({ isOpen, onClose, projectName, jobs, onRemoveChat, isRemoving }: ManageChatsModalProps) => {
  const { t } = useLanguage();

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('manageChatsInProject', { projectName })}</DialogTitle>
          <DialogDescription>{t('manageChatsDescription')}</DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-96 my-4">
          <div className="space-y-2 pr-4">
            {jobs.map(job => (
              <div key={job.id} className="flex items-center justify-between p-2 rounded-md border">
                <p className="text-sm truncate pr-4">{job.original_prompt || "Untitled Chat"}</p>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => onRemoveChat(job.id)} disabled={!!isRemoving}>
                  {isRemoving === job.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-destructive" />}
                </Button>
              </div>
            ))}
          </div>
        </ScrollArea>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};