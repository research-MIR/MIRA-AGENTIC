import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Users, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
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

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newPackName, setNewPackName] = useState('');
  const [newPackDescription, setNewPackDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);

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
    setIsCreating(true);
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
      setIsModalOpen(false);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to create pack: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <header className="pb-4 mb-8 border-b flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">{t('modelPacksTitle')}</h1>
          <p className="text-muted-foreground">{t('modelPacksDescription')}</p>
        </div>
        <Button onClick={() => setIsModalOpen(true)}>
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
            <Link key={pack.id} to={`/model-packs/${pack.id}`}>
              <Card className="hover:border-primary transition-colors h-full">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    <span className="truncate">{pack.name}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-3">{pack.description || "No description."}</p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      ) : (
        <div className="text-center py-16">
          <Users className="mx-auto h-16 w-16 text-muted-foreground" />
          <h2 className="mt-4 text-xl font-semibold">{t('noModelPacksTitle')}</h2>
          <p className="mt-2 text-muted-foreground">{t('noModelPacksDescription')}</p>
        </div>
      )}

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createNewModelPack')}</DialogTitle>
            <DialogDescription>{t('createNewModelPackDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div>
              <Label htmlFor="pack-name">{t('packName')}</Label>
              <Input id="pack-name" value={newPackName} onChange={(e) => setNewPackName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pack-description">{t('packDescription')}</Label>
              <Input id="pack-description" value={newPackDescription} onChange={(e) => setNewPackDescription(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={handleCreatePack} disabled={isCreating || !newPackName.trim()}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('createPack')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ModelPacks;