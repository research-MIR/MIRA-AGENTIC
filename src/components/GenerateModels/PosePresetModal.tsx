import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { useLanguage } from '@/context/LanguageContext';
import { CreatePosePackModal } from './CreatePosePackModal';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { showError, showSuccess } from '@/utils/toast';

interface Pose {
  type: 'text' | 'image';
  value: string;
}

interface PosePack {
  id: string;
  name: string;
  description: string | null;
  poses: Pose[];
}

interface PosePresetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyPoses: (poses: Pose[]) => void;
}

const systemPresets: PosePack[] = [
  {
    id: 'system-1',
    name: 'E-commerce Basics',
    description: 'A standard set of poses for e-commerce product showcases.',
    poses: [
      { type: 'text', value: 'Frontal, hands on hips, neutral expression' },
      { type: 'text', value: 'Three-quarter view, looking at camera' },
      { type: 'text', value: 'Side profile, standing straight' },
    ],
  },
  {
    id: 'system-2',
    name: 'Dynamic & Lifestyle',
    description: 'More active and natural poses for lifestyle or campaign imagery.',
    poses: [
      { type: 'text', value: 'Walking towards camera, natural movement' },
      { type: 'text', value: 'Leaning against a wall, casual pose' },
      { type: 'text', value: 'Looking over shoulder, slight smile' },
    ],
  },
];

export const PosePresetModal = ({ isOpen, onClose, onApplyPoses }: PosePresetModalProps) => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const { data: customPresets, isLoading } = useQuery<PosePack[]>({
    queryKey: ['posePacks', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-pose-packs').select('*').eq('user_id', session.user.id);
      if (error) throw error;
      return data;
    },
    enabled: isOpen,
  });

  const handleDeletePack = async (packId: string) => {
    try {
      const { error } = await supabase.from('mira-agent-pose-packs').delete().eq('id', packId);
      if (error) throw error;
      showSuccess("Pose pack deleted.");
      queryClient.invalidateQueries({ queryKey: ['posePacks'] });
    } catch (err: any) {
      showError(`Failed to delete pack: ${err.message}`);
    }
  };

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('usePosePresets')}</DialogTitle>
            <DialogDescription>Select a preset pack to quickly populate your poses, or create your own.</DialogDescription>
          </DialogHeader>
          <Tabs defaultValue="system" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="system">{t('systemPresets')}</TabsTrigger>
              <TabsTrigger value="custom">{t('myPresets')}</TabsTrigger>
            </TabsList>
            <TabsContent value="system">
              <ScrollArea className="h-96 p-1">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {systemPresets.map(pack => (
                    <Card key={pack.id}>
                      <CardHeader><CardTitle>{pack.name}</CardTitle></CardHeader>
                      <CardContent>
                        <p className="text-sm text-muted-foreground mb-4">{pack.description}</p>
                        <ul className="list-disc list-inside text-sm space-y-1">
                          {pack.poses.map((pose, i) => <li key={i} className="truncate">{pose.value}</li>)}
                        </ul>
                        <Button className="w-full mt-4" onClick={() => onApplyPoses(pack.poses)}>{t('useThisPack')}</Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
            <TabsContent value="custom">
              <ScrollArea className="h-96 p-1">
                {isLoading ? <Loader2 className="mx-auto my-12 h-8 w-8 animate-spin" /> : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {customPresets && customPresets.length > 0 ? customPresets.map(pack => (
                      <Card key={pack.id}>
                        <CardHeader>
                          <div className="flex justify-between items-center">
                            <CardTitle>{pack.name}</CardTitle>
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeletePack(pack.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <p className="text-sm text-muted-foreground mb-4">{pack.description}</p>
                          <ul className="list-disc list-inside text-sm space-y-1">
                            {pack.poses.map((pose, i) => <li key={i} className="truncate">{pose.value}</li>)}
                          </ul>
                          <Button className="w-full mt-4" onClick={() => onApplyPoses(pack.poses)}>{t('useThisPack')}</Button>
                        </CardContent>
                      </Card>
                    )) : <p className="text-center text-muted-foreground col-span-2 py-8">{t('noCustomPresets')}</p>}
                  </div>
                )}
              </ScrollArea>
              <Button className="w-full mt-4" variant="outline" onClick={() => setIsCreateModalOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                {t('createNewPosePack')}
              </Button>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
      <CreatePosePackModal 
        isOpen={isCreateModalOpen} 
        onClose={() => setIsCreateModalOpen(false)} 
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['posePacks'] })}
      />
    </>
  );
};