import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useSecureImage } from "@/hooks/useSecureImage";
import { BitStudioJob } from "@/types/vto";
import { AlertTriangle, Loader2, CheckCircle, XCircle } from "lucide-react";
import { useImagePreview } from "@/context/ImagePreviewContext";

const SecureImageDisplay = ({ imageUrl, alt }: { imageUrl: string | null, alt: string }) => {
    const { displayUrl, isLoading, error } = useSecureImage(imageUrl);
  
    if (!imageUrl) return <div className="w-full h-full bg-muted rounded-md" />;
    if (isLoading) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div>;
    if (error) return <div className="w-full h-full bg-muted rounded-md flex items-center justify-center"><AlertTriangle className="h-6 w-6 text-destructive" /></div>;
    
    return <img src={displayUrl} alt={alt} className="w-full h-full object-cover rounded-md" />;
};

interface RecentJobsListProps {
    jobs: BitStudioJob[] | undefined;
    isLoading: boolean;
    selectedJobId: string | null;
    onSelectJob: (job: BitStudioJob) => void;
    mode: 'base' | 'inpaint';
}

export const RecentJobsList = ({ jobs, isLoading, selectedJobId, onSelectJob, mode }: RecentJobsListProps) => {
    const { t } = useLanguage();
    const { showImage } = useImagePreview();

    const filteredJobs = useMemo(() => {
        if (!jobs) return [];
        return jobs.filter(job => job.mode === mode);
    }, [jobs, mode]);

    const handleThumbnailClick = (job: BitStudioJob) => {
        onSelectJob(job);
        if (job.status === 'complete' && job.final_image_url) {
            showImage({
                images: [{ url: job.final_image_url, jobId: job.id }],
                currentIndex: 0
            });
        }
    };

    return (
        <Card>
            <CardHeader><CardTitle>{t('recentJobs')}</CardTitle></CardHeader>
            <CardContent>
                {isLoading ? <Skeleton className="h-24 w-full" /> : filteredJobs && filteredJobs.length > 0 ? (
                    <ScrollArea className="h-32">
                        <div className="flex gap-4 pb-2">
                            {filteredJobs.map(job => {
                                const urlToPreview = job.final_image_url || job.metadata?.source_image_url || job.source_person_image_url;
                                const verification = job.metadata?.verification_result;
                                return (
                                    <button key={job.id} onClick={() => handleThumbnailClick(job)} className={cn("border-2 rounded-lg p-0.5 flex-shrink-0 w-24 h-24 relative", selectedJobId === job.id ? "border-primary" : "border-transparent")}>
                                        <SecureImageDisplay imageUrl={urlToPreview || null} alt="Recent job" />
                                        {verification && (
                                            <div className="absolute bottom-1 right-1">
                                                {verification.is_match ? (
                                                    <CheckCircle className="h-5 w-5 text-white bg-green-600 rounded-full p-0.5" />
                                                ) : (
                                                    <XCircle className="h-5 w-5 text-white bg-destructive rounded-full p-0.5" />
                                                )}
                                            </div>
                                        )}
                                    </button>
                                )
                            })}
                        </div>
                    </ScrollArea>
                ) : <p className="text-muted-foreground text-sm">{t('noRecentJobsVTO')}</p>}
            </CardContent>
        </Card>
    );
};