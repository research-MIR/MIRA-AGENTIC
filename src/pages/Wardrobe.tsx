import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { FolderSidebar, GarmentFolder } from "@/components/Wardrobe/FolderSidebar";
import { GarmentGrid } from "@/components/Wardrobe/GarmentGrid";
import { FolderModal } from "@/components/Wardrobe/FolderModal";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";
import { optimizeImage, calculateFileHash, sanitizeFilename } from "@/lib/utils";
import { Input } from "@/components/ui/input";

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve((reader.result as string).split(',')[1]);
    reader.onerror = (error) => reject(error);
  });
};

const Wardrobe = () => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [folderToEdit, setFolderToEdit] = useState<GarmentFolder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleNewFolder = () => {
    setFolderToEdit(null);
    setIsModalOpen(true);
  };

  const handleEditFolder = (folder: GarmentFolder) => {
    setFolderToEdit(folder);
    setIsModalOpen(true);
  };

  const handleSaveFolder = async (name: string) => {
    if (!session?.user) return;
    const toastId = showLoading(folderToEdit ? "Updating folder..." : "Creating folder...");
    try {
      const { error } = await supabase.from('mira-agent-garment-folders').upsert({
        id: folderToEdit?.id,
        user_id: session.user.id,
        name: name,
      });
      if (error) throw error;
      dismissToast(toastId);
      showSuccess(folderToEdit ? "Folder updated." : "Folder created.");
      queryClient.invalidateQueries({ queryKey: ['garmentFolderCounts'] });
      setIsModalOpen(false);
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    }
  };

  const handleGarmentDrop = async (folderId: string | null) => {
    const garmentId = (window as any).draggedGarmentId;
    if (!garmentId) return;

    try {
      const { error } = await supabase
        .from('mira-agent-garments')
        .update({ folder_id: folderId === 'unassigned' ? null : folderId })
        .eq('id', garmentId);
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['garments', session?.user?.id, selectedFolderId] });
      queryClient.invalidateQueries({ queryKey: ['garments', session?.user?.id, folderId] });
      queryClient.invalidateQueries({ queryKey: ['garmentFolderCounts', session?.user?.id] });
    } catch (err: any) {
      showError(`Failed to move garment: ${err.message}`);
    } finally {
      (window as any).draggedGarmentId = null;
    }
  };

  const handleFileUpload = async (files: FileList | null, targetFolderId?: string | null) => {
    if (!files || files.length === 0 || !session?.user) return;
    const imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    if (imageFiles.length === 0) {
      showError("Please select valid image files.");
      return;
    }

    const toastId = showLoading(`Processing ${imageFiles.length} image(s)...`);
    let successCount = 0;
    let movedCount = 0;
    const folderIdToAssign = targetFolderId !== undefined ? targetFolderId : selectedFolderId;

    try {
      for (const file of imageFiles) {
        const hash = await calculateFileHash(file);
        const { data: existing, error: checkError } = await supabase
          .from('mira-agent-garments')
          .select('id')
          .eq('user_id', session.user.id)
          .eq('image_hash', hash)
          .maybeSingle();

        if (checkError) throw checkError;
        
        if (existing) {
          const { error: moveError } = await supabase
            .from('mira-agent-garments')
            .update({ folder_id: folderIdToAssign === 'unassigned' ? null : folderIdToAssign })
            .eq('id', existing.id);
          if (moveError) throw moveError;
          movedCount++;
          continue;
        }

        const base64 = await fileToBase64(file);
        const { data: analysis, error: analysisError } = await supabase.functions.invoke('MIRA-AGENT-tool-analyze-garment-attributes', {
          body: { image_base64: base64, mime_type: file.type }
        });
        if (analysisError) throw new Error(`Analysis failed for ${file.name}: ${analysisError.message}`);

        const optimizedFile = await optimizeImage(file);
        const filePath = `${session.user.id}/wardrobe/${Date.now()}-${sanitizeFilename(file.name)}`;
        const { error: uploadError } = await supabase.storage.from('mira-agent-user-uploads').upload(filePath, optimizedFile);
        if (uploadError) throw new Error(`Upload failed for ${file.name}: ${uploadError.message}`);
        const { data: { publicUrl } } = supabase.storage.from('mira-agent-user-uploads').getPublicUrl(filePath);

        const { error: insertError } = await supabase.from('mira-agent-garments').insert({
          user_id: session.user.id,
          name: file.name,
          storage_path: publicUrl,
          attributes: analysis,
          image_hash: hash,
          folder_id: folderIdToAssign === 'all' || folderIdToAssign === 'unassigned' ? null : folderIdToAssign,
        });
        if (insertError) throw new Error(`Database insert failed for ${file.name}: ${insertError.message}`);
        
        successCount++;
      }

      dismissToast(toastId);
      let finalMessage = "";
      if (successCount > 0) finalMessage += `${successCount} new garment(s) added. `;
      if (movedCount > 0) finalMessage += `${movedCount} existing garment(s) moved.`;
      if (finalMessage) showSuccess(finalMessage.trim());
      
      queryClient.invalidateQueries({ queryKey: ['garments', session?.user?.id, selectedFolderId] });
      if (targetFolderId !== undefined && targetFolderId !== selectedFolderId) {
        queryClient.invalidateQueries({ queryKey: ['garments', session?.user?.id, targetFolderId] });
      }
      queryClient.invalidateQueries({ queryKey: ['garmentFolderCounts', session?.user?.id] });

    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    }
  };

  return (
    <>
      <div className="h-screen flex flex-col">
        <header className="p-4 border-b shrink-0">
          <h1 className="text-3xl font-bold">Wardrobe</h1>
          <p className="text-muted-foreground">Organize your uploaded garments into folders.</p>
        </header>
        <ResizablePanelGroup direction="horizontal" className="flex-1">
          <ResizablePanel defaultSize={20} minSize={15} maxSize={30}>
            <FolderSidebar
              selectedFolderId={selectedFolderId}
              onSelectFolder={setSelectedFolderId}
              onGarmentDrop={handleGarmentDrop}
              onFilesDropped={handleFileUpload}
              onNewFolder={handleNewFolder}
              onEditFolder={handleEditFolder}
              onUploadClick={() => fileInputRef.current?.click()}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={80}>
            <div className="p-4 h-full overflow-y-auto" onDragStart={(e) => { (window as any).draggedGarmentId = e.dataTransfer.getData("garmentId"); }}>
              <GarmentGrid selectedFolderId={selectedFolderId} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
      <FolderModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSave={handleSaveFolder}
        folderToEdit={folderToEdit}
      />
      <Input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFileUpload(e.target.files)}
      />
    </>
  );
};

export default Wardrobe;