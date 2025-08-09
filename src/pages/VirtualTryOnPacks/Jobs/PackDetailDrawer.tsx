import { useState, useEffect } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { PackSummary } from '../types';
import { api } from '../api';

function Thumb({ src }: { src: string }) {
  return <img src={src} className="h-24 w-18 rounded object-cover" alt="Garment thumbnail" />;
}

export function PackDetailDrawer({ pack, isOpen, onClose }: { pack: PackSummary | null, isOpen: boolean, onClose: () => void }) {
  const [thumbs, setThumbs] = useState<string[]>([]);
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    if (pack) {
      let mounted = true;
      api.getPackThumbs(pack.id).then(t => mounted && setThumbs(t));
      const unsub = api.subscribeLog(pack.id, (line) => setLog(l => [line, ...l].slice(0, 40)));
      return () => { mounted = false; unsub(); };
    }
  }, [pack]);

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent className="w-[520px] sm:w-[620px]">
        <SheetHeader>
          <SheetTitle>{pack?.name}</SheetTitle>
          <SheetDescription>Dettagli del pack e ultimi eventi</SheetDescription>
        </SheetHeader>
        <Separator className="my-4" />
        {pack && (
          <div className="space-y-4">
            <h4 className="font-semibold">Sample Garments</h4>
            <div className="grid grid-cols-4 gap-2">
              {thumbs.map((t, i) => <Thumb src={t} key={i} />)}
            </div>
            <h4 className="font-semibold">Job Log</h4>
            <div className="border rounded-lg p-2 bg-muted/50 h-64 overflow-auto text-xs font-mono">
              {log.map((l, i) => (<div key={i} className="py-0.5">{l}</div>))}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}