import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/components/Auth/SessionContextProvider';
import { Button } from '@/components/ui/button';
import { Folder, Plus, MoreVertical, Pencil, Trash2, Inbox, Archive } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { showError, showSuccess } from '@/utils/toast';

export interface GarmentFolder {
  id: string;
  name: string;
}

interface FolderSidebarProps {
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onDrop: (folderId: string | null) => void;
  onNewFolder: () => void;
  onEditFolder: (folder: GarmentFolder) => void;
}

const FolderItem = ({ folder, isSelected, onSelect, onDrop, onEdit, onDelete }: { folder: GarmentFolder, isSelected: boolean, onSelect: () => void, onDrop: () => void, onEdit: (folder: GarmentFolder) => void, onDelete: (folder: GarmentFolder) => void }) => {
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div
      onDrop={(e) => { e.preventDefault(); setIsDragOver(false); onDrop(); }}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      className={cn(
        "flex items-center justify-between p-2 rounded-md cursor-pointer group",
        isSelected ? "bg-primary/10 text-primary" : "hover:bg-muted",
        isDragOver && "bg-primary/20"
      )}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <Folder className="h-4 w-4" />
        <span className="text-sm font-medium truncate">{folder.name}</span>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
            <MoreVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent onClick={(e) => e.stopPropagation()}>
          <DropdownMenuItem onClick={() => onEdit(folder)}><Pencil className="mr-2 h-4 w-4" />Rename</DropdownMenuItem>
          <DropdownMenuItem className="text-destructive" onClick={() => onDelete(folder)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export const FolderSidebar = ({ selectedFolderId, onSelectFolder, onDrop, onNewFolder, onEditFolder }: FolderSidebarProps) => {
  const { supabase, session } = useSession();
  const queryClient = useQueryClient();
  const [folderToDelete, setFolderToDelete] = useState<GarmentFolder | null>(null);

  const { data: folders, isLoading } = useQuery<GarmentFolder[]>({
    queryKey: ['garmentFolders', session?.user?.id],
    queryFn: async () => {
      if (!session?.user) return [];
      const { data, error } = await supabase.from('mira-agent-garment-folders').select('id, name').eq('user_id', session.user.id).order('name', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!session?.user,
  });

  const handleDelete = async () => {
    if (!folderToDelete) return;
    const { error } = await supabase.from('mira-agent-garment-folders').delete().eq('id', folderToDelete.id);
    if (error) {
      showError(`Failed to delete folder: ${error.message}`);
    } else {
      showSuccess(`Folder "${folderToDelete.name}" deleted.`);
      queryClient.invalidateQueries({ queryKey: ['garmentFolders'] });
      onSelectFolder('all'); // Reselect all after deletion
    }
    setFolderToDelete(null);
  };

  return (
    <div className="p-4 h-full flex flex-col">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold">Folders</h2>
        <Button size="sm" onClick={onNewFolder}><Plus className="h-4 w-4 mr-2" />New Folder</Button>
      </div>
      <div className="space-y-1">
        <div className={cn("flex items-center gap-2 p-2 rounded-md cursor-pointer", selectedFolderId === 'all' ? "bg-primary/10 text-primary" : "hover:bg-muted")} onClick={() => onSelectFolder('all')}>
          <Archive className="h-4 w-4" />
          <span className="text-sm font-medium">All Garments</span>
        </div>
        <div className={cn("flex items-center gap-2 p-2 rounded-md cursor-pointer", selectedFolderId === 'unassigned' ? "bg-primary/10 text-primary" : "hover:bg-muted")} onClick={() => onSelectFolder('unassigned')}>
          <Inbox className="h-4 w-4" />
          <span className="text-sm font-medium">Unassigned</span>
        </div>
      </div>
      <div className="border-t my-4"></div>
      <div className="flex-1 overflow-y-auto space-y-1">
        {isLoading ? <p>Loading...</p> : folders?.map(folder => (
          <FolderItem
            key={folder.id}
            folder={folder}
            isSelected={selectedFolderId === folder.id}
            onSelect={() => onSelectFolder(folder.id)}
            onDrop={() => onDrop(folder.id)}
            onEdit={onEditFolder}
            onDelete={setFolderToDelete}
          />
        ))}
      </div>
      <AlertDialog open={!!folderToDelete} onOpenChange={(open) => !open && setFolderToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{folderToDelete?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the folder. Garments inside will become "Unassigned" and will not be deleted. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};