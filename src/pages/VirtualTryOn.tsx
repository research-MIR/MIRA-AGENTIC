import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { useLanguage } from "@/context/LanguageContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { RealtimeChannel } from "@supabase/supabase-js";
import { useSecureImage } from "@/hooks/useSecureImage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SingleTryOn } from "@/components/VTO/SingleTryOn";
import { BatchTryOn } from "@/components/VTO/BatchTryOn";
import { VirtualTryOnPro } from "@/components/VTO/VirtualTryOnPro";
import { cn } from "@/lib/utils";
import { AlertTriangle, ImageIcon, Loader2, Star, Shirt, HelpCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import ReactMarkdown from "react-markdown";
import { useImageTransferStore } from "@/store/imageTransferStore";
import { showError, showLoading, dismissToast, showSuccess } from "@/utils/toast";

const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = (error) => reject(error);
    });
};

interface BitStudioJob {
  id: string;
  status: 'queued' | 'processing' | 'complete' | 'failed';
  source_person_image_url: string;
  source_garment_image_url: string;
  final_image_url?: string;
  error_message?: string;
  mode: 'base' | 'inpaint';
  metadata?: {
    debug_assets?: any;
    prompt_used?: string;
  }
}

const SecureImageDisplay = ({ imageUrl, alt, onClick, className, style }: { 
    imageUrl: string | null, 
    alt: string, 
    onClick?: (e: React.MouseEvent<HTMLImageElement>) => void, 
    className?: string,
    style?: React.CSSProperties 
}) => {
    const { displayUrl, isLoading, error } = useSecureImage(imageUrl);
    const hasClickHandler = !!onClick;
  
    if (!imageUrl) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)} style={style}><ImageIcon className="h-6 w-6 text-muted-foreground" /></div>;
    if (isLoading) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)} style={style}><Loader2 className="h-6 w-6 animate-spin" /></div>;
    if (error) return <div className={cn("w-full h-full bg-muted rounded-md flex items-center justify-center", className)} style={style}><AlertTriangle className="h-6 w-6 text-destructive" /></div>;
    
    return <img src={displayUrl} alt={alt} className={cn("max-w-full max-h-full object-contain rounded-md", hasClickHandler && "cursor-pointer", className)} onClick={onClick} style={style} />;
};

const VirtualTryOn = () => {
  const { supabase, session, isProMode, toggleProMode } = useSession();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isHelpModalOpen, setIsHelpModalOpen] = useState(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  
  const { consumeImageUrl, imageUrlToTransfer, vtoTarget } = useImageTransferStore();

  useEffect(() => {
    console.log('[VTO Page] Image transfer effect triggered.');
    if (imageUrlToTransfer && vtoTarget) {
      if (vtoTarget === 'pro-source' && !isProMode) {
        console.log('[VTO Page] Switching to PRO mode for transferred image.');
        toggleProMode();
      }
      if (vtoTarget === 'base' && isProMode) {
        console.log('[VTO Page] Switching to Base mode for transferred image.');
        toggleProMode();
      }
    }
  }, [imageUrlToTransfer, vtoTarget, isProMode, toggleProMode]);

  const { data: recentJobs, isLoading: isLoadingRecentJobs } = useQuery<BitStudioJob[]>({
    queryKey: ['bitstudioJobs', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-bitstudio-jobs').select('*').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const selectedJob = useMemo(() => recentJobs?.find(job => job.id === selectedJobId), [recentJobs, selectedJobId]);

  const resetForm = useCallback(() => {
    setSelectedJobId(null);
    consumeImageUrl();
  }, [consumeImageUrl]);

  useEffect(() => {
    resetForm();
  }, [isProMode, resetForm]);

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

  const handleSelectJob = (job: BitStudioJob) => {
    setSelectedJobId(job.id);
  };

  return (
    <>
      <div className="p-4 md:p-8 h-screen flex flex-col">
        <header className="pb-4 mb-4 border-b shrink-0 flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold">{t('virtualTryOn')}</h1>
            <p className="text-muted-foreground">{t('vtoDescription')}</p>
          </div>
          <div className="flex items-center space-x-2">
            <Button variant="ghost" size="icon" onClick={() => setIsHelpModalOpen(true)}>
              <HelpCircle className="h-6 w-6" />
            </Button>
            <Label htmlFor="pro-mode-switch" className="flex items-center gap-2">
              <Star className="text-yellow-500" />
              {t('proMode')}
            </Label>
            <Switch id="pro-mode-switch" checked={isProMode} onCheckedChange={toggleProMode} />
          </div>
        </header>
        
        <div className="flex-1 overflow-y-auto">
          {isProMode ? (
            <VirtualTryOnPro 
              recentJobs={recentJobs}
              isLoadingRecentJobs={isLoadingRecentJobs}
              selectedJob={selectedJob}
              handleSelectJob={handleSelectJob}
              resetForm={resetForm}
              transferredImageUrl={vtoTarget === 'pro-source' ? imageUrlToTransfer : null}
              onTransferConsumed={consumeImageUrl}
            />
          ) : (
            <div className="h-full">
              <Tabs defaultValue="single" className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="single">{t('singleTryOn')}</TabsTrigger>
                  <TabsTrigger value="batch">{t('batchProcess')}</TabsTrigger>
                </TabsList>
                <TabsContent value="single" className="pt-6">
                  <p className="text-sm text-muted-foreground mb-6">{t('singleVtoDescription')}</p>
                  <SingleTryOn 
                    selectedJob={selectedJob} 
                    resetForm={resetForm} 
                    transferredImageUrl={vtoTarget === 'base' ? imageUrlToTransfer : null}
                    onTransferConsumed={consumeImageUrl}
                  />
                </TabsContent>
                <TabsContent value="batch" className="pt-6">
                  <p className="text-sm text-muted-foreground mb-6">{t('batchVtoDescription')}</p>
                  <BatchTryOn />
                </TabsContent>
              </Tabs>
              <Card className="mt-8">
                <CardHeader><CardTitle>{t('recentJobs')}</CardTitle></CardHeader>
                <CardContent>
                  {isLoadingRecentJobs ? <Skeleton className="h-24 w-full" /> : recentJobs && recentJobs.length > 0 ? (
                    <div className="flex gap-4 overflow-x-auto pb-2">
                      {recentJobs.filter(j => j.mode === 'base').map(job => {
                        const urlToPreview = job.final_image_url || job.source_person_image_url;
                        return (
                          <button key={job.id} onClick={() => handleSelectJob(job)} className={cn("border-2 rounded-lg p-1 flex-shrink-0 w-24 h-24", selectedJobId === job.id ? "border-primary" : "border-transparent")}>
                            <SecureImageDisplay imageUrl={urlToPreview} alt="Recent job" />
                          </button>
                        )
                      })}
                    </div>
                  ) : <p className="text-muted-foreground text-sm">{t('noRecentJobsVTO')}</p>}
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>

      <Dialog open={isHelpModalOpen} onOpenChange={setIsHelpModalOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('vtoHelpTitle')}</DialogTitle>
            <DialogDescription>{t('vtoHelpIntro')}</DialogDescription>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] pr-4">
            <div className="space-y-4 markdown-content">
              <h3>{t('vtoHelpSingleTitle')}</h3>
              <p>{t('vtoHelpSingleDesc')}</p>
              
              <h3>{t('vtoHelpBatchTitle')}</h3>
              <p>{t('vtoHelpBatchDesc')}</p>
              <ul>
                <li><ReactMarkdown>{t('vtoHelpBatchOneGarment')}</ReactMarkdown></li>
                <li><ReactMarkdown>{t('vtoHelpBatchRandom')}</ReactMarkdown></li>
                <li><ReactMarkdown>{t('vtoHelpBatchPrecise')}</ReactMarkdown></li>
              </ul>

              <h3>{t('vtoHelpProTitle')}</h3>
              <p>{t('vtoHelpProDesc')}</p>
              <ul>
                <li><ReactMarkdown>{t('vtoHelpProMasking')}</ReactMarkdown></li>
                <li><ReactMarkdown>{t('vtoHelpProReference')}</ReactMarkdown></li>
                <li><ReactMarkdown>{t('vtoHelpProSettings')}</ReactMarkdown></li>
              </ul>
            </div>
          </ScrollArea>
          <DialogFooter>
            <Button onClick={() => setIsHelpModalOpen(false)}>{t('done')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default VirtualTryOn;