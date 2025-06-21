import { useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Wand2, Brush, Palette, UploadCloud } from "lucide-react";
import { MaskCanvas } from "@/components/Editor/MaskCanvas";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDropzone } from "@/hooks/useDropzone";
import { MaskControls } from "@/components/Editor/MaskControls";

export const VirtualTryOnPro = () => {
  const [sourceImage, setSourceImage] = useState<string | null>(null);
  const [maskImage, setMaskImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [brushSize, setBrushSize] = useState(30);
  const [resetTrigger, setResetTrigger] = useState(0);

  const handleFileSelect = (file: File | null) => {
    if (file && file.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => {
        setSourceImage(e.target?.result as string);
        setMaskImage(null);
        setResetTrigger(c => c + 1);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleResetMask = () => {
    setResetTrigger(c => c + 1);
  };

  const { dropzoneProps, isDraggingOver } = useDropzone({
    onDrop: (e) => handleFileSelect(e.dataTransfer.files?.[0]),
  });

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      <div className="lg:col-span-1 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wand2 className="h-5 w-5" />
              Advanced Prompting
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="pro-prompt">Detailed Prompt</Label>
            <Textarea id="pro-prompt" placeholder="e.g., A photorealistic shot of the model wearing the garment, with dramatic side lighting..." rows={6} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Brush className="h-5 w-5" />
              Mask Editor
            </CardTitle>
          </CardHeader>
          <CardContent>
            {maskImage ? (
                <div>
                    <Label>Generated Mask</Label>
                    <img src={maskImage} alt="Generated Mask" className="w-full h-auto rounded-md mt-2 border bg-muted" />
                </div>
            ) : (
              <div className="text-sm text-muted-foreground">Draw on the image in the workbench to generate a mask.</div>
            )}
          </CardContent>
        </Card>
      </div>
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>PRO Workbench</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-center">
            {sourceImage ? (
              <div className="w-full max-h-[70vh] aspect-square relative">
                <MaskCanvas 
                  imageUrl={sourceImage} 
                  onMaskChange={setMaskImage}
                  brushSize={brushSize}
                  resetTrigger={resetTrigger}
                />
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                  <MaskControls 
                    brushSize={brushSize}
                    onBrushSizeChange={setBrushSize}
                    onReset={handleResetMask}
                  />
                </div>
              </div>
            ) : (
              <div
                {...dropzoneProps}
                className={cn(
                  "h-96 w-full bg-muted rounded-md flex flex-col items-center justify-center cursor-pointer border-2 border-dashed hover:border-primary transition-colors",
                  isDraggingOver && "border-primary bg-primary/10"
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadCloud className="h-12 w-12 text-muted-foreground" />
                <p className="mt-4 font-semibold">Upload an image to start</p>
                <p className="text-sm text-muted-foreground">Drag & drop or click to select a file</p>
                <Input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/*"
                  onChange={(e) => handleFileSelect(e.target.files?.[0])}
                />
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};