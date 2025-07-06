import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle, Loader2 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";

interface ImageResult {
  id: string;
  url: string;
}

interface ResultsDisplayProps {
  images: ImageResult[];
  isLoading: boolean;
  autoApprove: boolean;
  selectedImageId: string | null;
  onSelectImage: (id: string) => void;
}

export const ResultsDisplay = ({
  images,
  isLoading,
  autoApprove,
  selectedImageId,
  onSelectImage,
}: ResultsDisplayProps) => {
  const { t } = useLanguage();

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('resultsTitle')}</CardTitle>
          <CardDescription>{t('generating')}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-center p-12">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (images.length === 0) {
    return null; // Don't show anything if there are no images and not loading
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('resultsTitle')}</CardTitle>
        <CardDescription>
          {autoApprove ? t('resultsDescriptionAuto') : t('resultsDescriptionManual')}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className={cn("grid gap-4", autoApprove ? "grid-cols-1 max-w-sm mx-auto" : "grid-cols-2 md:grid-cols-4")}>
          {images.map((image) => {
            const isSelected = selectedImageId === image.id;
            return (
              <div key={image.id} className="space-y-2">
                <div className="relative group aspect-square">
                  <img src={image.url} alt={`Generated model ${image.id}`} className="w-full h-full object-cover rounded-md" />
                  {isSelected && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center rounded-md">
                      <CheckCircle className="h-12 w-12 text-white" />
                    </div>
                  )}
                </div>
                {!autoApprove && (
                  <Button
                    className="w-full"
                    variant={isSelected ? "secondary" : "default"}
                    onClick={() => onSelectImage(image.id)}
                  >
                    {isSelected ? t('selected') : t('selectImage')}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
};