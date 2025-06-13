import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";

interface ImageResult {
  publicUrl: string;
  storagePath: string;
  description?: string;
}

interface ImageChoiceProposal {
  summary: string;
  images: ImageResult[];
}

interface Props {
  data: ImageChoiceProposal;
  onChoose: (choiceText: string) => void;
}

export const ImageChoiceProposalCard = ({ data, onChoose }: Props) => {
  const { t } = useLanguage();

  const handleChoose = (image: ImageResult, index: number) => {
    const choiceText = `I choose image number ${index + 1}. The one described as: "${image.description || 'N/A'}". Please proceed.`;
    onChoose(choiceText);
  };

  return (
    <Card className="max-w-2xl w-full bg-secondary/50">
      <CardHeader>
        <CardTitle className="text-base font-semibold">{data.summary}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {data.images.map((image, index) => (
            <div key={index} className="space-y-2">
              <img
                src={image.publicUrl}
                alt={`Choice option ${index + 1}`}
                className="rounded-lg aspect-square object-cover w-full"
              />
              <Button
                size="sm"
                className="w-full"
                onClick={() => handleChoose(image, index)}
              >
                <CheckCircle className="mr-2 h-4 w-4" />
                Choose this one
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};