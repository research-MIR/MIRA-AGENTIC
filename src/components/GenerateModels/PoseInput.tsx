import React from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Trash2, UploadCloud } from "lucide-react";
import { useDropzone } from "@/hooks/useDropzone";
import { cn } from "@/lib/utils";

interface Pose {
  type: 'text' | 'image';
  value: string;
  file?: File;
  previewUrl?: string;
}

interface PoseInputProps {
  pose: Pose;
  index: number;
  onPoseChange: (index: number, newPose: Partial<Pose>) => void;
  onRemovePose: (index: number) => void;
  isJobActive: boolean;
  isOnlyPose: boolean;
}

export const PoseInput = ({ pose, index, onPoseChange, onRemovePose, isJobActive, isOnlyPose }: PoseInputProps) => {
  const { dropzoneProps, isDraggingOver } = useDropzone({
    onDrop: (e) => {
      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        const file = e.dataTransfer.files[0];
        onPoseChange(index, { file, previewUrl: URL.createObjectURL(file), value: file.name, type: 'image' });
      }
    }
  });

  return (
    <Card className="p-2">
      <div className="flex justify-end">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRemovePose(index)} disabled={isOnlyPose || isJobActive}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      <Tabs value={pose.type} onValueChange={(type) => onPoseChange(index, { type: type as 'text' | 'image' })}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="text">Text</TabsTrigger>
          <TabsTrigger value="image">Image</TabsTrigger>
        </TabsList>
        <TabsContent value="text" className="pt-2">
          <Input
            value={pose.type === 'text' ? pose.value : ''}
            onChange={(e) => onPoseChange(index, { value: e.target.value })}
            placeholder="E.g., frontal, hands on hips"
            disabled={isJobActive}
          />
        </TabsContent>
        <TabsContent value="image" className="pt-2">
          <Input
            type="file"
            id={`pose-upload-${index}`}
            className="hidden"
            accept="image/*"
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                const file = e.target.files[0];
                onPoseChange(index, { file, previewUrl: URL.createObjectURL(file), value: file.name });
              }
            }}
            disabled={isJobActive}
          />
          <div 
            {...dropzoneProps} 
            className={cn("p-4 border-2 border-dashed rounded-lg text-center hover:border-primary transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")}
            onClick={() => document.getElementById(`pose-upload-${index}`)?.click()}
          >
            {pose.previewUrl ? (
              <img src={pose.previewUrl} alt="Pose preview" className="h-24 mx-auto rounded-md" />
            ) : (
              <>
                <UploadCloud className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="mt-2 text-xs font-medium">Click or drag image</p>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
};