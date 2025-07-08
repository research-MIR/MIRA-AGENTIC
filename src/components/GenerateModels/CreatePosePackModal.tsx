import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Loader2 } from 'lucide-react';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { useLanguage } from '@/context/LanguageContext';
import { PoseInput } from './PoseInput';
import { ScrollArea } from '../ui/scroll-area';

interface Pose {
  type: 'text' | 'image';
  value: string;
  file?: File;
  previewUrl?: string;
}

interface CreatePosePackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export const CreatePosePackModal = ({ isOpen, onClose, onSuccess }: CreatePosePackModalProps) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [poses, setPoses] = useState<Pose[]>([{ type: 'text', value: '', file: undefined, previewUrl: undefined }]);
  const [isLoading, setIsLoading] = useState(false);

  const addPose = () => setPoses([...poses, { type: 'text', value: '', file: undefined, previewUrl: undefined }]);
  const removePose = (index: number) => setPoses(poses.filter((_, i) => i !== index));
  const updatePose = (index: number, newPose: Partial<Pose>) => setPoses(poses.map((p, i) => i === index ? { ...p, ...newPose } : p));

  const handleSave = async () => {
    if (!name.trim() || !session?.user) {
      showError("Please provide a name for the pack.");
      return;
    }
    const validPoses = poses.filter(p => p.value.trim() !== '');
    if (validPoses.length === 0) {
      showError("Please define at least one pose.");
      return;
    }

    setIsLoading(true);
    const toastId = showLoading("Saving pose pack...");

    try {
      const posesToSave = await Promise.all(validPoses.map(async (pose) => {
        if (pose.type === 'image' && pose.file) {
          const { data: { publicUrl } } = await supabase.storage.from('mira-agent-user-uploads').upload(`${session.user.id}/pose-pack-references/${Date.now()}-${pose.file.name}`, pose.file);
          return { type: 'image', value: publicUrl };
        }
        return { type: 'text', value: pose.value };
      }));

      const { error } = await supabase.from('mira-agent-pose-packs').insert({
        user_id: session.user.id,
        name,
        description,
        poses: posesToSave,
      });

      if (error) throw error;

      dismissToast(toastId);
      showSuccess("Pose pack saved!");
      onSuccess();
      onClose();
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to save pack: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('createNewPosePack')}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div>
            <Label htmlFor="pack-name">{t('posePackName')}</Label>
            <Input id="pack-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="pack-description">{t('posePackDescription')}</Label>
            <Textarea id="pack-description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div>
            <Label>{t('poses')}</Label>
            <ScrollArea className="h-64 pr-4">
              <div className="space-y-4">
                {poses.map((pose, index) => (
                  <PoseInput
                    key={index}
                    pose={pose}
                    index={index}
                    onPoseChange={updatePose}
                    onRemovePose={removePose}
                    isJobActive={isLoading}
                    isOnlyPose={poses.length <= 1}
                  />
                ))}
              </div>
            </ScrollArea>
            <Button variant="outline" className="w-full mt-4" onClick={addPose} disabled={isLoading}>
              <Plus className="mr-2 h-4 w-4" />
              {t('addPoseToPack')}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>{t('cancel')}</Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {t('savePosePack')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};