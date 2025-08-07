import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/components/Auth/SessionContextProvider";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { FolderSidebar, GarmentFolder } from "@/components/Wardrobe/FolderSidebar";
import { GarmentGrid } from "@/components/Wardrobe/GarmentGrid";
import { FolderModal } from "@/components/Wardrobe/FolderModal";
import { showError, showSuccess, showLoading, dismissToast } from "@/utils/toast";

const Wardrobe = () => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [folderToEdit, setFolderToEdit] = useState<GarmentFolder | null>(null);

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
      queryClient.invalidateQueries({ queryKey: ['garmentFolders'] });
      setIsModalOpen(false);
    } catch (err: any) {
      dismissToast(toastId);
      showError(err.message);
    }
  };

  const handleDrop = async (folderId: string | null) => {
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
    } catch (err: any) {
      showError(`Failed to move garment: ${err.message}`);
    } finally {
      (window as any).draggedGarmentId = null;
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
              onDrop={handleDrop}
              onNewFolder={handleNewFolder}
              onEditFolder={handleEditFolder}
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
    </>
  );
};

export default Wardrobe;