import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, Bot, Copy, AlertTriangle, GitBranch } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArtisanEngineResponse } from "@/components/Responses/ArtisanEngineResponse";
import { BrandAnalyzerResponse } from "@/components/Responses/BrandAnalyzerResponse";
import { JobStatusCard } from "@/components/Responses/JobStatusCard";
import { ImageGenerationResponse } from "@/components/Responses/ImageGenerationResponse";
import { CreativeProcessResponse } from "@/components/Responses/CreativeProcessResponse";
import { useImagePreview } from "@/context/ImagePreviewContext";
import { showSuccess } from "@/utils/toast";
import { RefinementProposalCard } from "@/components/Responses/RefinementProposalCard";
import { ImageChoiceProposalCard } from "@/components/Responses/ImageChoiceProposalCard";
import { ErrorCard } from "@/components/Responses/ErrorCard";
import { 
  ArtisanEngineResponseSchema,
  BrandAnalyzerResponseSchema,
  CreativeProcessResponseSchema,
  ImageGenerationResponseSchema,
  RefinementProposalSchema,
  ImageChoiceProposalSchema
} from "@/lib/schemas";

// Re-defining types here to make the component self-contained
// In a larger app, these would be in a central types file.
interface ImageResult { publicUrl: string; storagePath: string; description?: string; }
interface ImageAnalysis { image_description: string; lighting_style: string; photography_style: string; composition_and_setup: string; }
interface BrandAnalysisData { isBrandAnalysis: boolean; brand_name: string; website_analysis?: { url: string; analysis: { dominant_colors: string[]; image_analysis: ImageAnalysis[]; synthesis: string; }; }; social_media_analysis?: { url: string; analysis: { dominant_colors: string[]; image_analysis: ImageAnalysis[]; synthesis: string; }; }; combined_synthesis: string; follow_up_message?: string; }
interface ArtisanResponseData { isArtisanResponse: boolean; version: number; analysis: { [key: string]: string }; prompt: string; rationale: string; follow_up_message?: string; }
interface ImageGenerationData { isImageGeneration: true; images: ImageResult[]; follow_up_message?: string; }
interface CreativeProcessData { isCreativeProcess: true; iterations: any[]; final_generation_result: any; follow_up_message?: string; }
interface RefinementProposalData { summary: string; options: { url: string; jobId: string; }[]; }
interface ImageChoiceProposalData { summary: string; images: ImageResult[]; }

export interface Message { 
    from: "bot" | "user"; 
    jobId?: string; 
    text?: string; 
    imageUrls?: string[]; 
    artisanResponse?: ArtisanResponseData; 
    brandAnalysisResponse?: BrandAnalysisData; 
    imageGenerationResponse?: ImageGenerationData; 
    creativeProcessResponse?: CreativeProcessData; 
    jobInProgress?: { jobId: string; message: string; };
    refinementProposal?: RefinementProposalData;
    imageChoiceProposal?: ImageChoiceProposalData;
    imageChoiceSelectedIndex?: number;
    historyIndex?: number;
    error?: { message: string; jobId: string; };
}

const SafeComponent = ({ schema, data, Component, jobId, onRefinementComplete, onSendMessage, selectedIndex }: any) => {
  const parseResult = schema.safeParse(data);
  if (parseResult.success) {
    const props: any = { data: parseResult.data };
    if (jobId) props.jobId = jobId;
    if (onRefinementComplete) props.onRefinementComplete = onRefinementComplete;
    if (onSendMessage) props.onChoose = onSendMessage;
    if (selectedIndex !== undefined) props.selectedIndex = selectedIndex;
    return <Component {...props} />;
  } else {
    console.error("Zod validation failed:", parseResult.error.flatten());
    return (
      <Card className="max-w-lg bg-destructive/10 border-destructive">
        <CardContent className="p-3">
          <div className="flex items-center gap-3 text-destructive">
            <AlertTriangle size={20} />
            <p className="font-semibold">Agent response has an unexpected format and cannot be displayed.</p>
          </div>
        </CardContent>
      </Card>
    );
  }
};

interface MessageListProps {
  messages: Message[];
  jobId?: string;
  onRefinementComplete: (newImageUrl: string) => void;
  onSendMessage: (message: string) => void;
  onBranch: (historyIndex: number) => void;
  isOwner: boolean;
}

export const MessageList = ({ messages, jobId, onRefinementComplete, onSendMessage, onBranch, isOwner }: MessageListProps) => {
  const { showImage } = useImagePreview();

  return (
    <>
      {messages.map((message, index) => {
        const key = `${message.from}-${index}-${message.text || message.jobInProgress?.message || 'structured'}`;
        
        const nextMessage = messages[index + 1];
        if (message.imageGenerationResponse && nextMessage?.creativeProcessResponse) {
            // Heuristic: If an image generation card is immediately followed by a creative process summary,
            // assume the images are included in the summary and don't render the standalone card to avoid duplication.
            return null;
        }

        const isBotMessage = message.from === 'bot';
        const canBranch = isOwner && isBotMessage && message.historyIndex !== undefined && !message.jobInProgress;

        return (
          <div key={key} className={`group flex items-start gap-3 ${message.from === "user" ? "justify-end" : ""}`}>
            {message.from === 'bot' && !message.artisanResponse && !message.brandAnalysisResponse && !message.jobInProgress && !message.imageGenerationResponse && !message.creativeProcessResponse && !message.refinementProposal && !message.imageChoiceProposal && !message.error && <div className="p-2 bg-primary rounded-full text-primary-foreground self-start"><Bot size={20} /></div>}
            
            {message.error ? (
              <ErrorCard message={message.error.message} jobId={message.error.jobId} />
            ) : message.jobInProgress ? (
              <JobStatusCard message={message.jobInProgress.message} jobId={message.jobInProgress.jobId} />
            ) : message.creativeProcessResponse ? (
              <SafeComponent schema={CreativeProcessResponseSchema} data={message.creativeProcessResponse} Component={CreativeProcessResponse} jobId={jobId} />
            ) : message.imageGenerationResponse ? (
              <SafeComponent schema={ImageGenerationResponseSchema} data={message.imageGenerationResponse} Component={ImageGenerationResponse} jobId={jobId} />
            ) : message.refinementProposal ? (
              <SafeComponent schema={RefinementProposalSchema} data={message.refinementProposal} Component={RefinementProposalCard} onRefinementComplete={onRefinementComplete} />
            ) : message.imageChoiceProposal ? (
              <SafeComponent schema={ImageChoiceProposalSchema} data={message.imageChoiceProposal} Component={ImageChoiceProposalCard} onSendMessage={onSendMessage} selectedIndex={message.imageChoiceSelectedIndex} />
            ) : message.artisanResponse ? (
              <div className="flex items-center gap-2">
                <SafeComponent schema={ArtisanEngineResponseSchema} data={message.artisanResponse} Component={ArtisanEngineResponse} />
                <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(message.artisanResponse!.prompt); showSuccess("Prompt copied!"); }}><Copy className="h-4 w-4 mr-2" /> Copy</Button>
              </div>
            ) : message.brandAnalysisResponse ? (
              <SafeComponent schema={BrandAnalyzerResponseSchema} data={message.brandAnalysisResponse} Component={BrandAnalyzerResponse} />
            ) : (
              <Card className={`max-w-lg ${message.from === "user" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                <CardContent className="p-3">
                  {message.imageUrls && message.imageUrls.length > 0 && (
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      {message.imageUrls.map((url, i) => (
                        <button 
                          key={i} 
                          onClick={() => showImage({ 
                            images: message.imageUrls!.map(u => ({ url: u, jobId })),
                            currentIndex: i
                          })} 
                          className="block w-full h-full"
                        >
                            <img src={url} alt={`User upload ${i+1}`} className="rounded-md max-w-full" />
                        </button>
                      ))}
                    </div>
                  )}
                  {message.text && <div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown></div>}
                </CardContent>
              </Card>
            )}

            {canBranch && (
              <Button variant="ghost" size="icon" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => onBranch(message.historyIndex!)}>
                <GitBranch className="h-4 w-4" />
              </Button>
            )}

            {message.from === "user" && <div className="p-2 bg-secondary rounded-full text-secondary-foreground self-start"><User size={20} /></div>}
          </div>
        )
      })}
    </>
  );
};