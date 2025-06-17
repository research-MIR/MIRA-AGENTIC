import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bot, Image as ImageIcon } from "lucide-react";
import { useImagePreview } from "@/context/ImagePreviewContext";

interface ImageResult {
  publicUrl: string;
  storagePath: string;
}

interface Props {
  data: {
    images: ImageResult[];
  };
  jobId?: string;
}

export const ImageGenerationResponse = ({ data, jobId }: Props) => {
  const { showImage } = useImagePreview();

  if (!data || !data.images || data.images.length === 0) {
    return null; // Don't render anything if there are no images
  }

  const handleImageClick = (index: number) => {
    const imageList = data.images.map(img => ({ url: img.publicUrl, jobId }));
    showImage({ images: imageList, currentIndex: index });
  };

  return (
    <Card className="max-w-2xl w-full bg-secondary/50">
      <CardHeader className="p-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary rounded-full text-primary-foreground">
            <Bot size={20} />
          </div>
          <div className="text-left">
            <p className="font-semibold">Image Generation Complete</p>
            <p className="text-sm text-muted-foreground">
              Here are the {data.images.length} images you requested.
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {data.images.map((image, index) => (
            <button onClick={() => handleImageClick(index)} key={index} className="block w-full h-full">
              <img
                src={image.publicUrl}
                alt={`Generated image ${index + 1}`}
                className="rounded-lg aspect-square object-cover w-full h-full hover:opacity-80 transition-opacity"
              />
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};