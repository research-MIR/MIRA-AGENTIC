import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wand2, Loader2 } from "lucide-react";
import { useState } from "react";
import { useSession } from "./Auth/SessionContextProvider";
import { showError, showLoading, dismissToast } from "@/utils/toast";

interface RefinementOption {
  url: string;
  jobId: string;
}

interface RefinementProposal {
  summary: string;
  options: RefinementOption[];
}

interface Props {
  data: RefinementProposal;
  onRefinementComplete: (newImageUrl: string) => void;
}

export const RefinementProposalCard = ({ data, onRefinementComplete }: Props) => {
  const { supabase, session } = useSession();
  const [isLoading, setIsLoading] = useState<string | null>(null); // Store URL of loading image

  const handleRefineClick = async (option: RefinementOption) => {
    if (!session?.user) return showError("You must be logged in to refine images.");
    setIsLoading(option.url);
    const toastId = showLoading("Starting refinement job...");

    try {
      const { data: result, error } = await supabase.functions.invoke('MIRA-AGENT-tool-upscale-image-clarity', {
        body: {
          image_url: option.url,
          job_id: option.jobId,
          upscale_factor: 1.5
        }
      });

      if (error) throw error;
      if (!result?.upscaled_image?.url) throw new Error("Refinement service did not return a valid image.");

      onRefinementComplete(result.upscaled_image.url);
      dismissToast(toastId);
    } catch (err: any) {
      dismissToast(toastId);
      showError(`Refinement failed: ${err.message}`);
    } finally {
      setIsLoading(null);
    }
  };

  return (
    <Card className="max-w-2xl w-full bg-secondary/50">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{data.summary}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {data.options.map((option, index) => (
            <div key={index} className="space-y-2">
              <img
                src={option.url}
                alt={`Refinement option ${index + 1}`}
                className="rounded-lg aspect-square object-cover w-full"
              />
              <Button
                size="sm"
                className="w-full"
                onClick={() => handleRefineClick(option)}
                disabled={!!isLoading}
              >
                {isLoading === option.url ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Wand2 className="mr-2 h-4 w-4" />
                )}
                Refine
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};