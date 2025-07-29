import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Users, Plus, Loader2, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";

interface ModelPack {
  id: string;
  name: string;
  description: string | null;
}

const ModelPacks = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingPack, setEditingPack] = useState<ModelPack | null>(null);
  const [newPackName, setNewPackName] = useState('');
  const [newPackDescription, setNewPackDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: packs, isLoading, error } = useQuery<ModelPack[]>({
    queryKey: ["modelPacks", session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase
        .from("mira-agent-model-packs")
        .select("id, name, description")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const handleCreatePack = async () => {
    if (!newPackName.trim() || !session?.user) return;
    setIsSubmitting(true);
    const toastId = showLoading("Creating model pack...");
    try {
      const { error } = await supabase.from('mira-agent-model-packs').insert({
        name: newPackName,
        description: newPackDescription,
        user_id: session.user.id
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(`Pack "${newPackName}" created.`);
      setNewPackName('');
      setNewPackDescription('');
      queryClient.invalidateQueries({ queryKey: ['modelPacks'] });
      setIsCreateModalOpen(false);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to create pack: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditPack = (pack: ModelPack) => {
    setEditingPack(pack);
    setNewPackName(pack.name);
    setNewPackDescription(pack.description || '');
    setIsEditModalOpen(true);
  };

  const handleUpdatePack = async () => {
    if (!editingPack || !newPackName.trim()) return;
    setIsSubmitting(true);
    const toastId = showLoading("Updating pack...");
    try {
      const { error } = await supabase.from('mira-agent-model-packs')
        .update({ name: newPackName, description: newPackDescription })
        .eq('id', editingPack.id);
      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Pack updated.");
      queryClient.invalidateQueries({ queryKey: ['modelPacks'] });
      setIsEditModalOpen(false);
      setEditingPack(null);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to update pack: ${err.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeletePack = async (packId: string) => {
    if (!session?.user) return;
    const toastId = showLoading("Deleting pack...");
    try {
      const { error } = await supabase.rpc('delete_model_pack_and_unassign_models', {
        p_pack_id: packId,
        p_user_id: session.user.id
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess("Pack deleted.");
      queryClient.invalidateQueries({ queryKey: ['modelPacks'] });
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to delete pack: ${err.message}`);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t('modelPacksTitle')}</h1>
          <p className="text-muted-foreground">{t('modelPacksDescription')}</p>
        </div>
        <Button onClick={() => setIsCreateModalOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          {t('newModelPack')}
        </Button>
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-48 w-full" />)}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      ) : packs && packs.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {packs.map(pack => (
            <Card key={pack.id} className="hover:border-primary transition-colors h-full flex flex-col group">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <Link to={`/model-packs/${pack.id}`} className="flex items-center gap-2 w-full">
                    <Users className="h-5 w-5 text-primary flex-shrink-0" />
                    <CardTitle className="truncate text-base">{pack.name}</CardTitle>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-7 w-7 flex-shrink-0 -mr-2 -mt-2 opacity-0 group-hover:opacity-100">
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleEditPack(pack)}><Pencil className="mr-2 h-4 w-4" />Edit</DropdownMenuItem>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader><AlertDialogTitle>Are you sure?</AlertDialogTitle><AlertDialogDescription>This will delete the pack and unassign all models from it. The models themselves will not be deleted.</AlertDialogDescription></AlertDialogHeader>
                          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleDeletePack(pack.id)}>Delete</AlertDialogAction></AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardHeader>
              <Link to={`/model-packs/${pack.id}`} className="flex-1 flex flex-col">
                <CardContent className="flex-1">
                  <p className="text-sm text-muted-foreground line-clamp-3">{pack.description || "No description."}</p>
                </CardContent>
              </Link>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <Users className="mx-auto h-16 w-16 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">{t('noModelPacksTitle')}</h2>
          <p className="mt-2 text-muted-foreground">{t('noModelPacksDescription')}</p>
        </div>
      )}

      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{t('createNewModelPack')}</DialogTitle><DialogDescription>{t('createNewModelPackDescription')}</DialogDescription></DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label htmlFor="pack-name">{t('packName')}</Label><Input id="pack-name" value={newPackName} onChange={(e) => setNewPackName(e.target.value)} /></div>
            <div><Label htmlFor="pack-description">{t('packDescription')}</Label><Input id="pack-description" value={newPackDescription} onChange={(e) => setNewPackDescription(e.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setIsCreateModalOpen(false)}>{t('cancel')}</Button><Button onClick={handleCreatePack} disabled={isSubmitting || !newPackName.trim()}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{t('createPack')}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Pack</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-4">
            <div><Label htmlFor="edit-pack-name">{t('packName')}</Label><Input id="edit-pack-name" value={newPackName} onChange={(e) => setNewPackName(e.target.value)} /></div>
            <div><Label htmlFor="edit-pack-description">{t('packDescription')}</Label><Input id="edit-pack-description" value={newPackDescription} onChange={(e) => setNewPackDescription(e.target.value)} /></div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setIsEditModalOpen(false)}>{t('cancel')}</Button><Button onClick={handleUpdatePack} disabled={isSubmitting || !newPackName.trim()}>{isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Save Changes</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ModelPacks;