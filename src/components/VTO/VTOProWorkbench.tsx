import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Image as ImageIcon, UploadCloud, Eye } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { BitStudioJob } from '@/types/vto';
import { SecureImageDisplay } from './SecureImageDisplay';

interface VTOProWorkbenchProps {
    selectedJob: BitStudioJob | undefined;
    sourceImageUrl: string | null;
    onFileSelect: (file: File | null) => void;
    onDebugOpen: () => void;
}

export const VTOProWorkbench = ({
    selectedJob, sourceImageUrl, onFileSelect, onDebugOpen
}: VTOProWorkbenchProps) => {
    const { t } = useLanguage();
    const { showImage } = useImagePreview();
    const { dropzoneProps, isDraggingOver } = useDropzone({
        onDrop: (e) => onFileSelect(e.dataTransfer.files?.[0]),
    });

    const renderJobResult = (job: BitStudioJob) => {
        if (job.status === 'failed') return <p className="text-destructive text-sm p-2">{t('jobFailed', { errorMessage: job.error_message })}</p>;
        if (job.status === 'complete' && job.final_image_url) {
          return (
            <div className="relative group w-full h-full">
              <SecureImageDisplay imageUrl={job.final_image_url} alt="Final Result" onClick={() => showImage({ images: [{ url: job.final_image_url! }], currentIndex: 0 })} />
              {job.metadata?.debug_assets && (
                <Button 
                  variant="secondary" 
                  className="absolute bottom-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDebugOpen();
                  }}
                >
                  <Eye className="mr-2 h-4 w-4" />
                  Show Steps
                </Button>
              )}
            </div>
          );
        }
        return (
          <div className="text-center text-muted-foreground">
            <Loader2 className="h-12 w-12 mx-auto animate-spin" />
            <p className="mt-4">{t('jobStatus', { status: job.status })}</p>
          </div>
        );
    };

    return (
        <div className="lg:col-span-2 bg-muted rounded-lg flex flex-col items-stretch justify-center relative min-h-[60vh] lg:min-h-0">
            {sourceImageUrl && !selectedJob ? (
                <div className="w-full h-full flex items-center justify-center p-2">
                    <SecureImageDisplay imageUrl={sourceImageUrl} alt="Source for VTO Pro" />
                </div>
            ) : selectedJob ? (
                renderJobResult(selectedJob)
            ) : (
                <div {...dropzoneProps} className={cn("w-full h-full flex flex-col items-center justify-center cursor-pointer border-2 border-dashed rounded-lg", isDraggingOver && "border-primary")}>
                    <UploadCloud className="h-12 w-12 text-muted-foreground" />
                    <p className="mt-4 font-semibold">{t('uploadToBegin')}</p>
                    <p className="text-sm text-muted-foreground">{t('orSelectRecent')}</p>
                </div>
            )}
        </div>
    );
};