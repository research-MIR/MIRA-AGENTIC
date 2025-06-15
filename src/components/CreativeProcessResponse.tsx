import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, Image as ImageIcon, FileText, MessageSquareQuote } from "lucide-react";
import { ArtisanEngineResponse } from "./ArtisanEngineResponse";
import { ImageGenerationResponse } from "./ImageGenerationResponse";

interface Critique {
    critique_text: string;
    is_good_enough: boolean;
    diary_entry: string;
}

interface GenerationResult {
    toolName: string;
    response: any;
}

interface Iteration {
    artisan_result?: any;
    initial_generation_result?: GenerationResult;
    refined_generation_result?: GenerationResult;
    critique_result?: Critique;
}

interface Props {
  data: {
    iterations: Iteration[];
    final_generation_result: GenerationResult;
  };
  jobId?: string;
}

export const CreativeProcessResponse = ({ data, jobId }: Props) => {
  const totalIterations = data.iterations.length;
  const finalTitle = data.final_generation_result?.toolName === 'fal_image_to_image' 
    ? "Final Refined Result" 
    : "Final Approved Result";
  const isProcessComplete = !!data.final_generation_result;

  return (
    <Card className="max-w-2xl w-full bg-secondary/50">
      <CardHeader className="p-4">
         <div className="flex items-center gap-3">
            <div className="p-2 bg-primary rounded-full text-primary-foreground">
                <Bot size={20} />
            </div>
            <div className="text-left">
                <p className="font-semibold">Creative Process Complete</p>
                <p className="text-sm text-muted-foreground">
                Finished in {totalIterations} iteration(s).
                </p>
            </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <Accordion type="multiple" className="w-full space-y-2">
          {data.iterations.map((iteration, index) => {
            const { artisan_result, initial_generation_result, critique_result } = iteration;
            
            // If there's nothing to show for this iteration, don't render the card at all.
            if (!artisan_result && !initial_generation_result && !critique_result) {
                return null;
            }

            const isApproved = critique_result?.is_good_enough;
            const isLastIteration = index === totalIterations - 1;

            let statusText = "";
            let statusColor = "text-muted-foreground";

            if (critique_result) {
                statusText = isApproved ? "Approved" : "Rejected";
                statusColor = isApproved ? 'text-green-500' : 'text-destructive';
            } else if (isLastIteration && isProcessComplete) {
                statusText = "Final";
                statusColor = "text-primary";
            } else if (!isProcessComplete) {
                statusText = "In Progress...";
            }

            return (
              <Card key={index} className="bg-background/50">
                <AccordionItem value={`iteration-${index}`} className="border-none">
                  <AccordionTrigger className="p-3 hover:no-underline">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-semibold ${statusColor}`}>
                          Iteration {index + 1}{statusText ? `: ${statusText}` : ''}
                      </span>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent className="p-3 pt-0 space-y-3">
                      {artisan_result && (
                        <>
                          <h4 className="text-xs font-semibold uppercase text-muted-foreground">Artisan Prompt V{artisan_result.version || index + 1}</h4>
                          <ArtisanEngineResponse data={artisan_result} />
                        </>
                      )}
                      
                      {initial_generation_result && (
                        <>
                          <h4 className="text-xs font-semibold uppercase text-muted-foreground mt-4">Generated Images (Iteration {index + 1})</h4>
                          <ImageGenerationResponse data={initial_generation_result.response} jobId={jobId} />
                        </>
                      )}

                      {critique_result && (
                        <>
                          <h4 className="text-xs font-semibold uppercase text-muted-foreground mt-4">Art Director's Critique</h4>
                          <Card className="bg-secondary/80">
                              <CardContent className="p-3">
                                  <p className="text-sm italic">"{critique_result.critique_text}"</p>
                              </CardContent>
                          </Card>
                        </>
                      )}
                  </AccordionContent>
                </AccordionItem>
              </Card>
            )
          })}
        </Accordion>
        {data.final_generation_result && (
            <div className="mt-4">
                <h3 className="text-lg font-semibold mb-2">{finalTitle}</h3>
                <ImageGenerationResponse data={data.final_generation_result.response} jobId={jobId} />
            </div>
        )}
      </CardContent>
    </Card>
  );
};