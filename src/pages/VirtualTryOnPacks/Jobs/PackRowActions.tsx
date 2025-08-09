import { useState } from 'react';
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { MoreHorizontal, FileDown, History, Repeat2, Wand2, BarChart2 } from "lucide-react";
import { PackSummary } from '../types';
import { api } from '../api';

export function PackRowActions({ pack }: { pack: PackSummary }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Pack Actions">
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => api.openReport(pack.id)} disabled={!pack.hasReport}>
          <BarChart2 className="mr-2 h-4 w-4" />
          Vedi Report
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => api.downloadPack(pack.id)}>
          <FileDown className="mr-2 h-4 w-4" />
          Scarica Pack
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => api.analyzePack(pack.id)}>
          <History className="mr-2 h-4 w-4" />
          Analizza Pack
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => api.refinePack(pack.id)}>
          <Wand2 className="mr-2 h-4 w-4" />
          Affina Pack
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => api.retryIncomplete(pack.id)}>
          <Repeat2 className="mr-2 h-4 w-4" />
          Riavvia incompleti
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}