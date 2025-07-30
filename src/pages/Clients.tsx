import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Users, Plus, Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { ClientCard } from "@/components/Clients/ClientCard";
import { NewClientCard } from "@/components/Clients/NewClientCard";

interface Client {
  client_id: string;
  client_name: string;
  project_count: number;
}

const Clients = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const { data: clients, isLoading, error } = useQuery<Client[]>({
    queryKey: ["clientPreviews", session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.rpc('get_client_previews', { p_user_id: session.user.id });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const handleCreateClient = async () => {
    if (!newClientName.trim() || !session?.user) return;
    setIsCreating(true);
    const toastId = showLoading("Creating client...");
    try {
      const { error } = await supabase.from('mira-agent-clients').insert({ name: newClientName, user_id: session.user.id });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(`Client "${newClientName}" created.`);
      setNewClientName('');
      queryClient.invalidateQueries({ queryKey: ['clientPreviews'] });
      setIsModalOpen(false);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Failed to create client: ${err.message}`);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <>
      <div className="p-4 md:p-8 h-screen overflow-y-auto">
        <header className="pb-4 mb-8">
          <h1 className="text-3xl font-bold">{t('clientsTitle')}</h1>
          <p className="text-muted-foreground">{t('clientsDescription')}</p>
        </header>
        
        {isLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : error ? (
          <Alert variant="destructive">
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>{error.message}</AlertDescription>
          </Alert>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
            {clients?.map(client => (
              <ClientCard key={client.client_id} client={client} />
            ))}
            <NewClientCard onClick={() => setIsModalOpen(true)} />
          </div>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('createNewClient')}</DialogTitle>
            <DialogDescription>{t('createNewClientDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Label htmlFor="client-name">{t('clientName')}</Label>
            <Input id="client-name" value={newClientName} onChange={(e) => setNewClientName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleCreateClient()} />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsModalOpen(false)}>{t('cancel')}</Button>
            <Button onClick={handleCreateClient} disabled={isCreating || !newClientName.trim()}>
              {isCreating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('createClient')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default Clients;