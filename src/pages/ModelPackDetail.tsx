import { useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ModelGenerator } from "@/components/GenerateModels/ModelGenerator";
import { RecentJobThumbnail } from "@/components/GenerateModels/RecentJobThumbnail";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const ModelPackDetail = () => {
  const { packId } = useParams();
  const { supabase } = useSession();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const { data: pack, isLoading: isLoadingPack, error: packError } = useQuery({
    queryKey: ['modelPack', packId],
    queryFn: async () => {
      if (!packId) return null;
      const { data, error } = await supabase.from('mira-agent-model-packs').select('*').eq('id', packId).single();
      if (error) throw error;
      return data;
    },
    enabled: !!packId,
  });

  const { data: models, isLoading: isLoadingModels, error: modelsError } = useQuery({
    queryKey: ['modelsForPack', packId],
    queryFn: async () => {
      if (!packId) return [];
      const { data, error } = await supabase.rpc('get_models_for_pack', { p_pack_id: packId });
      if (error) throw error;
      return data;
    },
    enabled: !!packId,
  });

  const selectedJob = models?.find(job => job.id === selectedJobId);

  if (isLoadingPack) {
    return <div className="p-8"><Skeleton className="h-12 w-1/3" /><Skeleton className="mt-4 h-64 w-full" /></div>;
  }

  if (packError) {
    return <div className="p-8"><Alert variant="destructive"><AlertTitle>Error</AlertTitle><AlertDescription>{packError.message}</AlertDescription></Alert></div>;
  }

  if (!pack) {
    return <div className="p-8"><Alert><AlertTitle>Not Found</AlertTitle><AlertDescription>This model pack could not be found.</AlertDescription></Alert></div>;
  }

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col">
      <header className="pb-4 mb-8 border-b shrink-0">
        <h1 className="text-3xl font-bold">{pack.name}</h1>
        <p className="text-muted-foreground">{pack.description || "No description provided."}</p>
      </header>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-hidden">
        <div className="lg:col-span-2 flex flex-col gap-4">
          <Card className="flex-1 flex flex-col">
            <CardHeader><CardTitle>Models in this Pack ({models?.length || 0})</CardTitle></CardHeader>
            <CardContent className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                {isLoadingModels ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pr-4">
                    {[...Array(4)].map((_, i) => <Skeleton key={i} className="aspect-square w-full" />)}
                  </div>
                ) : models && models.length > 0 ? (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pr-4">
                    {models.map(job => (
                      <RecentJobThumbnail
                        key={job.id}
                        job={job}
                        onClick={() => setSelectedJobId(job.id)}
                        isSelected={selectedJobId === job.id}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No models have been generated for this pack yet.</p>
                )}
              </ScrollArea>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-1 overflow-y-auto no-scrollbar">
          <ModelGenerator packId={packId!} selectedJob={selectedJob} />
        </div>
      </div>
    </div>
  );
};

export default ModelPackDetail;