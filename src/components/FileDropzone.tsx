import { useCallback, useState } from 'react';
import { UploadCloud } from 'lucide-react';

interface FileDropzoneProps {
  onDrop: (files: FileList) => void;
  onDragStateChange: (isDragging: boolean) => void;
}

export const FileDropzone = ({ onDrop, onDragStateChange }: FileDropzoneProps) => {
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const handleDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onDragStateChange(false);
  }, [onDragStateChange]);

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onDragStateChange(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDrop(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  }, [onDrop, onDragStateChange]);

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4"
    >
      <div
        className={`w-full h-full flex flex-col items-center justify-center rounded-lg border-4 border-dashed transition-colors duration-200 pointer-events-none
          ${isDraggingOver ? 'border-primary bg-primary-foreground bg-opacity-20' : 'border-gray-400 bg-gray-500 bg-opacity-10'}`}
      >
        <UploadCloud className={`w-16 h-16 mb-4 transition-colors duration-200 ${isDraggingOver ? 'text-primary' : 'text-gray-300'}`} />
        <p className="text-2xl font-bold text-white">Drop your file here</p>
        <p className="text-gray-300">Upload an image, document, or audio file.</p>
      </div>
    </div>
  );
};