import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Wand2 } from "lucide-react";
import { JobsTable } from "./Jobs/JobsTable";
import { Wizard } from "./Wizard/Wizard";

function Header({ view, setView }: { view: string, setView: (v: string) => void }) {
  return (
    <div className="flex items-center justify-between py-4">
      <div className="flex items-center gap-3">
        <div className="text-2xl font-semibold">Camerino Virtuale (PACKS)</div>
      </div>
      <div className="flex items-center gap-2">
        {view === 'jobs' && (
          <Button className="rounded-2xl" onClick={() => setView('wizard')}>
            <Wand2 className="mr-2 h-4 w-4" /> Crea Batch
          </Button>
        )}
      </div>
    </div>
  );
}

export default function VirtualTryOnPacks() {
  const [view, setView] = useState<'jobs' | 'wizard'>('jobs');

  return (
    <div className="p-4 md:p-8 h-screen overflow-y-auto">
      <Header view={view} setView={setView} />
      {view === 'wizard' ? (
        <Wizard onSubmitted={() => setView('jobs')} />
      ) : (
        <JobsTable />
      )}
    </div>
  );
}