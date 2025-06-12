import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, Bot, Copy } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArtisanEngineResponse } from "@/components/ArtisanEngineResponse";
import { BrandAnalyzerResponse } from "@/components/BrandAnalyzerResponse";
import { JobStatusCard } from "@/components/JobStatusCard";
import { ImageGenerationResponse } from "@/components/ImageGenerationResponse";
import { CreativeProcessResponse } from "@/components/CreativeProcessResponse";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { showSuccess } from "@/utils/toast";

// Re-defining types here to make the component self-contained
// In a larger app, these would be in a central types file.
interface ImageResult { publicUrl: string; storagePath: string; }
interface ImageAnalysis { image_description: string; lighting_style: string; photography_style: string; composition_and_setup: string; }
interface BrandAnalysisData { isBrandAnalysis: boolean; brand_name: string; website_analysis?: { url: string; analysis: { dominant_colors: string[]; image_analysis: ImageAnalysis[]; synthesis: string; }; }; social_media_analysis?: { url: string; analysis: { dominant_colors: string[]; image_analysis: ImageAnalysis[]; synthesis: string; }; }; combined_synthesis: string; follow_up_message?: string; }
interface ArtisanResponseData { isArtisanResponse: boolean; version: number; analysis: { [key: string]: string }; prompt: string; rationale: string; follow_up_message?: string; }
interface ImageGenerationData { isImageGeneration: true; images: ImageResult[]; follow_up_message?: string; }
interface CreativeProcessData { isCreativeProcess: true; iterations: any[]; final_generation_result: any; follow_up_message?: string; }
export interface Message { from: "bot" | "user"; jobId?: string; text?: string; imageUrls?: string[]; artisanResponse?: ArtisanResponseData; brandAnalysisResponse?: BrandAnalysisData; imageGenerationResponse?: ImageGenerationData; creativeProcessResponse?: CreativeProcessData; jobInProgress?: { jobId: string; message: string; }; }

interface MessageListProps {
  messages: Message[];
  jobId?: string;
}

export const MessageList = ({ messages, jobId }: MessageListProps) => {
  const { showImage } = useImagePreview();

  return (
    <>
      {messages.map((message, index) => {
        // Create a more stable key than just the index
        const key = `${message.from}-${index}-${message.text || message.jobInProgress?.message || 'structured'}`;
        
        return (
          <div key={key} className={`flex items-start gap-3 ${message.from === "user" ? "justify-end" : ""}`}>
            {message.from === "bot" && !message.artisanResponse && !message.brandAnalysisResponse && !message.jobInProgress && !message.imageGenerationResponse && !message.creativeProcessResponse && <div className="p-2 bg-primary rounded-full text-primary-foreground self-start"><Bot size={20} /></div>}
            
            {message.jobInProgress ? (
              <JobStatusCard message={message.jobInProgress.message} />
            ) : message.creativeProcessResponse ? (
              <CreativeProcessResponse data={message.creativeProcessResponse} jobId={jobId} />
            ) : message.imageGenerationResponse ? (
              <ImageGenerationResponse data={message.imageGenerationResponse} jobId={jobId} />
            ) : message.artisanResponse ? (
              <div className="flex items-center gap-2">
                <ArtisanEngineResponse data={message.artisanResponse} />
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(message.artisanResponse!.prompt); showSuccess("Prompt copied!"); }}><Copy className="h-4 w-4 mr-2" /> Copy</Button>
              </div>
            ) : message.brandAnalysisResponse ? (
              <BrandAnalyzerResponse data={message.brandAnalysisResponse} />
            ) : (
              <Card className={`max-w-lg ${message.from === "user" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                <CardContent className="p-3">
                  {message.imageUrls && message.imageUrls.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {message.imageUrls.map((url, i) => (
                        <button key={i} onClick={() => showImage({ url, jobId })} className="block w-full h-full">
                            <img src={url} alt={`User upload ${i+1}`} className="rounded-md max-w-full" />
                        </button>
                      ))}
                    </div>
                  )}
                  {message.text && <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown></div>}
                </CardContent>
              </Card>
            )}

            {message.from === "user" && <div className="p-2 bg-secondary rounded-full text-secondary-foreground self-start"><User size={20} /></div>}
          </div>
        )
      })}
    </>
  );
};