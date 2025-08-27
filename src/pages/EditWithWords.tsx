"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import ImageUploader from '@/components/ImageUploader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, AlertCircle } from 'lucide-react';
import { useToast } from "@/components/ui/use-toast";

interface RecentEdit {
  id: string;
  final_result: { publicUrl: string };
  created_at: string;
}

const EditWithWords = () => {
  const [sourceImage, setSourceImage] = useState<File | null>(null);
  const [referenceImages, setReferenceImages] = useState<File[]>([]);
  const [instruction, setInstruction] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultImageUrl, setResultImageUrl] = useState<string | null>(null);
  const [recentEdits, setRecentEdits] = useState<RecentEdit[]>([]);
  const { toast } = useToast();

  const fetchRecentEdits = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data, error } = await supabase
      .from('mira-agent-comfyui-jobs')
      .select('id, final_result, created_at')
      .eq('user_id', user.id)
      .eq('metadata->>source', 'edit-with-words')
      .order('created_at', { ascending: false })
      .limit(5);

    if (error) {
      console.error("Error fetching recent edits:", error);
    } else if (data) {
      setRecentEdits(data as RecentEdit[]);
    }
  }, []);

  useEffect(() => {
    fetchRecentEdits();
  }, [fetchRecentEdits]);

  const handleGenerate = useCallback(async () => {
    if (!sourceImage) {
      setError('Please upload a source image.');
      return;
    }
    if (!instruction.trim()) {
      setError('Please provide an instruction.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setResultImageUrl(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("You must be logged in to generate images.");

      const uploadFile = async (file: File, folder: string) => {
        const filePath = `${user.id}/${folder}/${Date.now()}-${file.name}`;
        const { error: uploadError } = await supabase.storage
          .from('mira-agent-user-uploads')
          .upload(filePath, file);
        if (uploadError) throw uploadError;
        const { data: { publicUrl } } = supabase.storage
          .from('mira-agent-user-uploads')
          .getPublicUrl(filePath);
        return publicUrl;
      };

      const source_image_url = await uploadFile(sourceImage, 'edit-with-words/source');
      
      const reference_image_urls = await Promise.all(
        referenceImages.map(file => uploadFile(file, 'edit-with-words/reference'))
      );

      const { data, error: functionError } = await supabase.functions.invoke('MIRA-AGENT-tool-edit-with-words', {
        body: {
          source_image_url,
          reference_image_urls,
          instruction,
          invoker_user_id: user.id,
        },
      });

      if (functionError) {
        throw new Error(`Generation failed: ${functionError.message || JSON.stringify(functionError)}`);
      }
      
      if (data.error) {
        throw new Error(`Generation failed: ${data.error}`);
      }

      if (!data.finalImageUrl) {
        throw new Error("Generation succeeded but did not return an image URL.");
      }

      setResultImageUrl(data.finalImageUrl);
      
      toast({
        title: "Success!",
        description: "Your image has been edited.",
      });
      
      fetchRecentEdits(); // Refresh recent edits list

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred.';
      setError(`Failed to generate the image. ${errorMessage}`);
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  }, [sourceImage, referenceImages, instruction, toast, fetchRecentEdits]);

  return (
    <div className="bg-gray-900 text-white min-h-screen p-8">
      <h1 className="text-3xl font-bold mb-6">Modifica con Parole</h1>
      <p className="text-gray-400 mb-8">Modifica le tue immagini usando semplici istruzioni di testo.</p>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Input Column */}
        <div className="flex flex-col gap-6 p-6 bg-gray-800 rounded-lg">
          <h2 className="text-xl font-semibold">1. Provide Images</h2>
          <ImageUploader
            label="Immagine Sorgente"
            onFilesChange={(files) => setSourceImage(files[0] || null)}
            multiple={false}
          />
          <ImageUploader
            label="Immagini di Riferimento"
            onFilesChange={setReferenceImages}
            multiple={true}
          />
          <div>
            <h2 className="text-xl font-semibold mb-4">2. Istruzione di Modifica</h2>
            <Input
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Es. rendi i suoi blu, aggiungi un cappello alla persona..."
              className="bg-gray-700 border-gray-600 text-white"
            />
          </div>
          <Button onClick={handleGenerate} disabled={isLoading} className="w-full">
            {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Genera
          </Button>
          {error && (
            <div className="flex items-center gap-2 text-red-400">
              <AlertCircle size={16} />
              <p className="text-sm">{error}</p>
            </div>
          )}
        </div>

        {/* Output Column */}
        <div className="flex flex-col gap-6 p-6 bg-gray-800 rounded-lg">
          <h2 className="text-xl font-semibold">Risultato</h2>
          <div className="flex items-center justify-center w-full h-96 bg-gray-900 rounded-lg">
            {isLoading ? (
              <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
            ) : resultImageUrl ? (
              <img src={resultImageUrl} alt="Generated result" className="max-w-full max-h-full object-contain rounded-lg" />
            ) : (
              <p className="text-gray-500">Carica un'immagine di base per iniziare.</p>
            )}
          </div>
          <h2 className="text-xl font-semibold">Modifiche Recenti</h2>
          <div className="flex flex-col gap-4">
            {recentEdits.length > 0 ? (
              recentEdits.map(edit => (
                <div key={edit.id} className="flex items-center gap-4 p-2 bg-gray-700 rounded-md">
                  <img src={edit.final_result.publicUrl} alt="Recent edit" className="w-16 h-16 object-cover rounded" />
                  <div className="text-sm text-gray-400">
                    <p>ID: {edit.id.substring(0, 8)}...</p>
                    <p>{new Date(edit.created_at).toLocaleString()}</p>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-gray-500">Nessuna modifica recente trovata.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default EditWithWords;