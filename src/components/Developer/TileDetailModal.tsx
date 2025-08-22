import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SecureImageDisplay } from "@/components/VTO/SecureImageDisplay";

interface Tile {
  source_tile_path: string;
  generated_tile_url: string;
  generated_prompt: string;
  tile_index: number;
  source_tile_bucket: string;
}

interface TileDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  tile: Tile | null;
  supabase: any;
}

export const TileDetailModal = ({ isOpen, onClose, tile, supabase }: TileDetailModalProps) => {
  if (!isOpen || !tile) return null;

  const sourceUrl = supabase.storage.from(tile.source_tile_bucket).getPublicUrl(tile.source_tile_path).data.publicUrl;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Tile #{tile.tile_index} Details</DialogTitle>
          <DialogDescription>
            A detailed look at the source, generated output, and prompt for this tile.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 py-4">
          <div className="space-y-2">
            <h3 className="font-semibold text-center">Source Tile</h3>
            <div className="aspect-square bg-muted rounded-md">
              <SecureImageDisplay imageUrl={sourceUrl} alt="Source Tile" />
            </div>
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold text-center">Generated Tile</h3>
            <div className="aspect-square bg-muted rounded-md">
              <SecureImageDisplay imageUrl={tile.generated_tile_url} alt="Generated Tile" />
            </div>
          </div>
        </div>
        <Card>
          <CardContent className="p-3">
            <p className="text-xs font-mono text-muted-foreground">{tile.generated_prompt}</p>
          </CardContent>
        </Card>
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};