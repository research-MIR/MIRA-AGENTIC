import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { showError, showSuccess, showLoading, dismissToast } from '@/utils/toast';
import { Copy } from 'lucide-react';

interface VtoPack {
  pack_id: string;
  sharing_mode: 'private' | 'public_link';
}

interface ShareVtoReportModalProps {
  pack: VtoPack | null;
  isOpen: boolean;
  onClose: () => void;
}

export const ShareVtoReportModal = ({ pack, isOpen, onClose }: ShareVtoReportModalProps) => {
  const { supabase } = useSession();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('private');

  useEffect(() => {
    if (pack) {
      setActiveTab(pack.sharing_mode);
    }
  }, [pack]);

  const handleTabChange = async (value: string) => {
    if (!pack) return;
    const toastId = showLoading("Updating sharing settings...");
    try {
      const { error } = await supabase.rpc('set_vto_pack_sharing_mode', { 
        p_pack_id: pack.pack_id, 
        p_sharing_mode: value 
      });
      if (error) throw error;
      setActiveTab(value);
      queryClient.invalidateQueries({ queryKey: ['vtoPackDetails', pack.pack_id] });
      dismissToast(toastId);
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    }
  };

  const handleCopyLink = () => {
    if (!pack) return;
    const link = `${window.location.origin}/vto-reports/${pack.pack_id}`;
    navigator.clipboard.writeText(link);
    showSuccess("Link copied to clipboard!");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share VTO Report</DialogTitle>
          <DialogDescription>Manage access to your VTO analysis report.</DialogDescription>
        </DialogHeader>
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="private">Private</TabsTrigger>
            <TabsTrigger value="public_link">Public Link</TabsTrigger>
          </TabsList>
          <TabsContent value="private" className="pt-4">
            <p className="text-sm text-muted-foreground">Only you can access this report.</p>
          </TabsContent>
          <TabsContent value="public_link" className="pt-4 space-y-4">
            <p className="text-sm text-muted-foreground">Anyone with the link can view this report.</p>
            <div className="flex items-center space-x-2">
              <Input value={`${window.location.origin}/vto-reports/${pack?.pack_id}`} readOnly />
              <Button onClick={handleCopyLink}><Copy className="h-4 w-4" /></Button>
            </div>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};