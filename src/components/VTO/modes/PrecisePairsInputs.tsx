import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlusCircle, X } from 'lucide-react';
import { SecureImageDisplay } from '../SecureImageDisplay';
import { useLanguage } from "@/context/LanguageContext";

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear }: { onFileSelect: (file: File) => void, title: string, imageUrl: string | null, onClear: () => void }) => {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const { useDropzone } = require('@/hooks/useDropzone');
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e: React.DragEvent<HTMLElement>) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files[0]) });
    const { cn } = require('@/lib/utils');
    const { PlusCircle } = require('lucide-react');
    const { Input } = require('@/components/ui/input');

    if (imageUrl) {
      return (
        <div className="relative aspect-square">
          <img src={imageUrl} alt={title} className="w-full h-full object-cover rounded-md" />
          <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={onClear}><X className="h-4 w-4" /></Button>
        </div>
      );
    }
  
    return (
      <div {...dropzoneProps} className={cn("flex aspect-square justify-center items-center rounded-lg border border-dashed p-4 text-center transition-colors cursor-pointer", isDraggingOver && "border-primary bg-primary/10")} onClick={() => inputRef.current?.click()}>
        <div className="text-center pointer-events-none"><PlusCircle className="mx-auto h-8 w-8 text-muted-foreground" /><p className="mt-2 text-sm font-semibold">{title}</p></div>
        <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e: React.ChangeEvent<HTMLInputElement>) => e.target.files && onFileSelect(e.target.files[0])} />
      </div>
    );
};

interface PrecisePairsInputsProps {
  precisePairs: any[];
  setPrecisePairs: (pairs: any[]) => void;
  tempPairPersonUrl: string | null;
  setTempPairPersonUrl: (url: string | null) => void;
  tempPairGarmentFile: File | null;
  setTempPairGarmentFile: (file: File | null) => void;
  tempPairGarmentUrl: string | null;
  tempPairAppendix: string;
  setTempPairAppendix: (appendix: string) => void;
  addPrecisePair: () => void;
  setIsModelModalOpen: (isOpen: boolean) => void;
}

export const PrecisePairsInputs = ({
  precisePairs,
  setPrecisePairs,
  tempPairPersonUrl,
  setTempPairPersonUrl,
  tempPairGarmentFile,
  setTempPairGarmentFile,
  tempPairGarmentUrl,
  tempPairAppendix,
  setTempPairAppendix,
  addPrecisePair,
  setIsModelModalOpen,
}: PrecisePairsInputsProps) => {
  const { t } = useLanguage();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
      <Card>
        <CardHeader>
            <CardTitle>{t('precisePairsInputTitle')}</CardTitle>
            <CardDescription>{t('precisePairsInputDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-2">
                <Label>{t('person')}</Label>
                <div className="aspect-square w-full bg-muted rounded-md flex items-center justify-center">
                    {tempPairPersonUrl ? (
                        <div className="relative w-full h-full">
                            <SecureImageDisplay imageUrl={tempPairPersonUrl} alt="Selected Person" />
                            <Button variant="destructive" size="icon" className="absolute top-2 right-2 h-6 w-6 z-10" onClick={() => setTempPairPersonUrl(null)}><X className="h-4 w-4" /></Button>
                        </div>
                    ) : (
                        <Button variant="outline" onClick={() => setIsModelModalOpen(true)}>Select Model</Button>
                    )}
                </div>
            </div>
            <ImageUploader onFileSelect={(file) => setTempPairGarmentFile(file)} title={t('garment')} imageUrl={tempPairGarmentUrl} onClear={() => setTempPairGarmentFile(null)} />
          </div>
          <div>
            <Label htmlFor="pair-appendix">{t('promptAppendixPair')}</Label>
            <Input id="pair-appendix" value={tempPairAppendix} onChange={(e) => setTempPairAppendix(e.target.value)} placeholder={t('promptAppendixPairPlaceholder')} />
          </div>
          <Button className="w-full" onClick={addPrecisePair} disabled={!tempPairPersonUrl || !tempPairGarmentFile}>{t('addPairToQueue')}</Button>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>{t('batchQueue')}</CardTitle></CardHeader>
        <CardContent>
          <ScrollArea className="h-96">
            <div className="space-y-2 pr-4">
              {precisePairs.map((pair, i) => (
                <div key={i} className="flex gap-2 items-center bg-muted p-2 rounded-md">
                  <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0"><SecureImageDisplay imageUrl={pair.person.url} alt="Person" /></div>
                  <PlusCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0"><img src={pair.garment.url} alt="Garment" className="w-full h-full object-cover" /></div>
                  <p className="text-xs text-muted-foreground flex-1 truncate italic">"{pair.appendix}"</p>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPrecisePairs(p => p.filter((_, idx) => idx !== i))}><X className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
};