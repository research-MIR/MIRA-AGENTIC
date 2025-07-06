import React, { useState, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ModelPoseSelector } from './ModelPoseSelector';
import { SecureImageDisplay } from './SecureImageDisplay';
import { useLanguage } from '@/context/LanguageContext';
import { PlusCircle, Shirt, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useDropzone } from '@/hooks/useDropzone';

export interface QueueItem {
  person_url: string;
  garment_url: string;
  appendix?: string;
}

interface VtoInputProviderProps {
  mode: 'one-to-many' | 'precise-pairs';
  onQueueReady: (queue: QueueItem[]) => void;
}

const ImageUploader = ({ onFileSelect, title, imageUrl, onClear }: { onFileSelect: (file: File) => void, title: string, imageUrl: string | null, onClear: () => void }) => {
    const inputRef = useRef<HTMLInputElement>(null);
    const { dropzoneProps, isDraggingOver } = useDropzone({ onDrop: (e) => e.dataTransfer.files && onFileSelect(e.dataTransfer.files[0]) });
  
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
        <Input ref={inputRef} type="file" className="hidden" accept="image/*" onChange={(e) => e.target.files && onFileSelect(e.target.files[0])} />
      </div>
    );
};

export const VtoInputProvider = ({ mode, onQueueReady }: VtoInputProviderProps) => {
  const { t } = useLanguage();
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  
  // State for one-to-many mode
  const [selectedModelUrls, setSelectedModelUrls] = useState<Set<string>>(new Set());
  const [garmentFile, setGarmentFile] = useState<File | null>(null);
  const [generalAppendix, setGeneralAppendix] = useState("");

  // State for precise-pairs mode
  const [precisePairs, setPrecisePairs] = useState<QueueItem[]>([]);
  const [tempPairPersonUrl, setTempPairPersonUrl] = useState<string | null>(null);
  const [tempPairGarmentFile, setTempPairGarmentFile] = useState<File | null>(null);
  const [tempPairAppendix, setTempPairAppendix] = useState("");

  const garmentFileUrl = useMemo(() => garmentFile ? URL.createObjectURL(garmentFile) : null, [garmentFile]);
  const tempPairGarmentUrl = useMemo(() => tempPairGarmentFile ? URL.createObjectURL(tempPairGarmentFile) : null, [tempPairGarmentFile]);

  const handleModelSelect = (url: string) => {
    if (mode === 'one-to-many') {
      setSelectedModelUrls(prev => {
        const newSet = new Set(prev);
        if (newSet.has(url)) newSet.delete(url);
        else newSet.add(url);
        return newSet;
      });
    } else { // precise-pairs
      setTempPairPersonUrl(url);
      setIsModelModalOpen(false);
    }
  };

  const addPrecisePair = () => {
    if (tempPairPersonUrl && tempPairGarmentFile) {
      const garmentUrl = URL.createObjectURL(tempPairGarmentFile);
      setPrecisePairs(prev => [...prev, { person_url: tempPairPersonUrl, garment_url: garmentUrl, appendix: tempPairAppendix }]);
      setTempPairPersonUrl(null);
      setTempPairGarmentFile(null);
      setTempPairAppendix("");
    }
  };

  const handleProceed = () => {
    let queue: QueueItem[] = [];
    if (mode === 'one-to-many' && garmentFile) {
      const garmentUrl = URL.createObjectURL(garmentFile);
      queue = Array.from(selectedModelUrls).map(personUrl => ({
        person_url: personUrl,
        garment_url: garmentUrl,
        appendix: generalAppendix,
      }));
    } else if (mode === 'precise-pairs') {
      queue = precisePairs;
    }
    onQueueReady(queue);
  };

  const isProceedDisabled = mode === 'one-to-many' 
    ? (selectedModelUrls.size === 0 || !garmentFile)
    : precisePairs.length === 0;

  return (
    <div className="max-w-4xl mx-auto">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {mode === 'one-to-many' ? (
          <>
            <Card>
              <CardHeader><CardTitle>1. {t('selectModels')}</CardTitle></CardHeader>
              <CardContent>
                <Button variant="outline" className="w-full" onClick={() => setIsModelModalOpen(true)}>
                  <Users className="mr-2 h-4 w-4" />
                  {t('selectModels')} ({selectedModelUrls.size})
                </Button>
                <ScrollArea className="h-48 mt-4 border rounded-md p-2">
                  <div className="grid grid-cols-4 gap-2">
                    {Array.from(selectedModelUrls).map(url => <SecureImageDisplay key={url} imageUrl={url} alt="Selected Model" />)}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>2. {t('uploadGarment')}</CardTitle></CardHeader>
              <CardContent>
                <ImageUploader onFileSelect={setGarmentFile} title={t('garmentImage')} imageUrl={garmentFileUrl} onClear={() => setGarmentFile(null)} />
                <div className="mt-4">
                  <Label htmlFor="general-appendix">{t('promptAppendix')}</Label>
                  <Textarea id="general-appendix" value={generalAppendix} onChange={(e) => setGeneralAppendix(e.target.value)} placeholder={t('promptAppendixPlaceholder')} rows={2} />
                </div>
              </CardContent>
            </Card>
          </>
        ) : (
          <>
            <Card>
              <CardHeader><CardTitle>{t('addPair')}</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>{t('person')}</Label>
                    <div className="aspect-square bg-muted rounded-md flex items-center justify-center">
                      {tempPairPersonUrl ? <SecureImageDisplay imageUrl={tempPairPersonUrl} alt="Selected Model" /> : <Users className="h-12 w-12 text-muted-foreground" />}
                    </div>
                    <Button variant="outline" className="w-full" onClick={() => setIsModelModalOpen(true)}>Select Model</Button>
                  </div>
                  <div className="space-y-2">
                    <Label>{t('garment')}</Label>
                    <ImageUploader onFileSelect={setTempPairGarmentFile} title={t('garmentImage')} imageUrl={tempPairGarmentUrl} onClear={() => setTempPairGarmentFile(null)} />
                  </div>
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
                        <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0"><SecureImageDisplay imageUrl={pair.person_url} alt="Person" /></div>
                        <PlusCircle className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                        <div className="w-16 h-16 rounded-md overflow-hidden flex-shrink-0"><img src={pair.garment_url} alt="Garment" className="w-full h-full object-cover" /></div>
                        <p className="text-xs text-muted-foreground flex-1 truncate italic">"{pair.appendix}"</p>
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPrecisePairs(p => p.filter((_, idx) => idx !== i))}><X className="h-4 w-4" /></Button>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CardContent>
            </Card>
          </>
        )}
      </div>
      <div className="mt-8 text-center">
        <Button size="lg" onClick={handleProceed} disabled={isProceedDisabled}>{t('reviewQueue', { count: mode === 'one-to-many' ? selectedModelUrls.size : precisePairs.length })}</Button>
      </div>
      <Dialog open={isModelModalOpen} onOpenChange={setIsModelModalOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader><DialogTitle>Select a Model</DialogTitle></DialogHeader>
          <ModelPoseSelector mode={mode === 'one-to-many' ? 'multiple' : 'single'} selectedUrls={selectedModelUrls} onSelect={handleModelSelect} />
          <DialogFooter>
            <Button onClick={() => setIsModelModalOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};