import React, { useState, useEffect, useRef, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { useLanguage } from "@/context/LanguageContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SingleTryOn } from "@/components/VTO/SingleTryOn";
import { BatchTryOn } from "@/components/VTO/BatchTryOn";
import { cn } from "@/lib/utils";
import { AlertTriangle, ImageIcon, Loader2 } from "lucide-react";

interface BitStudioJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  source_person_image_url: string;
  source_garment_image_url: string;
  final_image_url?: string;
  error_message?: string;
  mode: 'base' | 'pro';
}

const SecureImageDisplay = ({ imageUrl, alt, onClick }: { imageUrl: string | null, alt: string, onClick?: (e: React.MouseEvent<HTMLImageElement>) => void }) => {
    const { displayUrl, isLoading, error } = useSecureImage(imageUrl);
    const hasClickHandler = !!onClick;
  
    if (!imageUrl) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
    if (isLoading) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    if (error) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><AlertTriangle className="h-6 w-6 text-destructive" /></div>;
    
    return <img src={displayUrl} alt={alt} className={cn("w-full h-full object-contain rounded-md", hasClickHandler && "cursor-pointer")} onClick={onClick} />;
};

const VirtualTryOn = () => {
  const { supabase, session } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const { data: recentJobs, isLoading: isLoadingRecentJobs } = useQuery<BitStudioJob[]>({
    queryKey: ['bitstudioJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const selectedJob = useMemo(() => recentJobs?.find(job => job.id === selectedJobId), [recentJobs, selectedJobId]);

  useEffect(() => {
    if (!session?.user?.id) {
      return;
    }

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }

    console.log(`[VTO Realtime] Attempting to subscribe for user: ${session.user.id}`);
    const channel = supabase
      .channel(`bitstudio-jobs-tracker-${session.user.id}`)
      .on<BitStudioJob>(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'mira-agent-bitstudio-jobs',
          filter: `user_id=eq.${session.user.id}`,
        },
        (payload) => {
          console.log('[VTO Realtime] Received payload:', payload);
          queryClient.invalidateQueries({ queryKey: ['bitstudioJobs', session.user.id] });
        }
      )
      .subscribe((status, err) => {
        console.log(`[VTO Realtime] Subscription status: ${status}`);
        if (status === 'SUBSCRIBED') {
          console.log('[VTO Realtime] Successfully subscribed to bitstudio-jobs updates.');
        }
        if (status === 'CHANNEL_ERROR' || err) {
          console.error('[VTO Realtime] Subscription channel error:', err);
        }
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        console.log('[VTO Realtime] Cleaning up subscription.');
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [session?.user?.id, supabase, queryClient]);

  const resetForm = () => {
    setSelectedJobId(null);
  };

  const handleSelectJob = (job: BitStudioJob) => {
    setSelectedJobId(job.id);
  };

  return (
    <div className="p-4 md:p-8 h-screen flex flex-col">
      <header className="pb-4 mb-8 border-b shrink-0">
        <h1 className="text-3xl font-bold">{t('virtualTryOn')}</h1>
        <p className="text-muted-foreground">{t('vtoDescription')}</p>
      </header>
      <div className="flex-1 overflow-y-auto">
        <Tabs defaultValue="single" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="single">{t('singleTryOn')}</TabsTrigger>
            <TabsTrigger value="batch">{t('batchProcess')}</TabsTrigger>
          </TabsList>
          <TabsContent value="single" className="pt-6">
            <p className="text-sm text-muted-foreground mb-6">{t('singleVtoDescription')}</p>
            <SingleTryOn selectedJob={selectedJob} resetForm={resetForm} />
          </TabsContent>
          <TabsContent value="batch" className="pt-6">
            <p className="text-sm text-muted-foreground mb-6">{t('batchVtoDescription')}</p>
            <BatchTryOn />
          </TabsContent>
        </Tabs>
        <Card className="mt-8">
          <CardHeader><CardTitle>Recent Jobs</CardTitle></CardHeader>
          <CardContent>
            {isLoadingRecentJobs ? <Skeleton className="h-24 w-full" /> : recentJobs && recentJobs.length > 0 ? (
              <div className="flex gap-4 overflow-x-auto pb-2">
                {recentJobs.map(job => {
                  const urlToPreview = job.final_image_url || job.source_person_image_url;
                  return (
                    <button key={job.id} onClick={() => handleSelectJob(job)} className={cn("border-2 rounded-lg p-1 flex-shrink-0 w-24 h-24", selectedJobId === job.id ? "border-primary" : "border-transparent")}>
                      <SecureImageDisplay imageUrl={urlToPreview} alt="Recent job" />
                    </button>
                  )
                })}
              </div>
            ) : <p className="text-muted-foreground text-sm">No recent jobs found.</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default VirtualTryOn;