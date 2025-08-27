"use client";

import { UploadCloud, X } from 'lucide-react';
import React, { useCallback, useState } from 'react';
import { useDropzone } from 'react-dropzone';

interface ImageUploaderProps {
  onFilesChange: (files: File[]) => void;
  multiple?: boolean;
  label: string;
}

const ImageUploader: React.FC<ImageUploaderProps> = ({ onFilesChange, multiple = false, label }) => {
  const [previews, setPreviews] = useState<string[]>([]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    onFilesChange(acceptedFiles);
    const newPreviews = acceptedFiles.map(file => URL.createObjectURL(file));
    setPreviews(prev => multiple ? [...prev, ...newPreviews] : newPreviews);
  }, [onFilesChange, multiple]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.png', '.webp', '.gif'] },
    multiple,
  });

  const removeFile = (indexToRemove: number) => {
    setPreviews(prev => prev.filter((_, index) => index !== indexToRemove));
    // This is a simplified way to update the parent component's file list
    // A more robust solution would involve managing files by a unique ID
    onFilesChange([]); 
  };


  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-medium text-gray-300">{label}</label>
      <div
        {...getRootProps()}
        className={`relative flex flex-col items-center justify-center w-full h-64 border-2 border-dashed rounded-lg cursor-pointer transition-colors ${
          isDragActive ? 'border-blue-500 bg-gray-700' : 'border-gray-600 bg-gray-800 hover:border-gray-500'
        }`}
      >
        <input {...getInputProps()} />
        {previews.length > 0 ? (
          <div className="flex flex-wrap items-center justify-center gap-2 p-4">
            {previews.map((src, index) => (
              <div key={index} className="relative h-24 w-24">
                <img src={src} alt={`preview ${index}`} className="h-full w-full object-cover rounded-md" />
                <button
                  onClick={(e) => { e.stopPropagation(); removeFile(index); }}
                  className="absolute top-[-5px] right-[-5px] p-1 bg-red-600 rounded-full text-white hover:bg-red-700 transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
             {multiple && (
              <div className="flex items-center justify-center h-24 w-24 border-2 border-dashed rounded-lg border-gray-600 text-gray-400">
                <UploadCloud size={24} />
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center pt-5 pb-6 text-gray-400">
            <UploadCloud className="w-8 h-8 mb-4" />
            <p className="mb-2 text-sm"><span className="font-semibold">Click to upload</span> or drag and drop</p>
            <p className="text-xs">PNG, JPG, WEBP, or GIF</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImageUploader;