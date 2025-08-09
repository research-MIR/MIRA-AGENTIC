import { useState, useMemo } from 'react';
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { VtoMode, PairInput, GenerationSettings } from '../types';
import { api } from '../api';
import { Stepper } from './Stepper';
import { StepMode } from './StepMode';
import { StepInputs } from './StepInputs';
import { StepReview } from './StepReview';

export function Wizard({ onSubmitted }: { onSubmitted: (packId: string) => void }) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<VtoMode | null>(null);
  const [queue, setQueue] = useState<PairInput[]>([]);
  const [settings, setSettings] = useState<GenerationSettings>({
    engine: "default",
    aspectRatio: "4:5",
    cropMode: "smart",
    strictCompatibility: true,
    autoCompleteOutfit: false,
    retryPolicy: { maxRetries: 2, backoffMs: 1000 },
  });

  const handleGenerate = async () => {
    if (!mode) return;
    if (!queue.length) {
      toast.error("Nessuna coppia valida");
      return;
    }
    const payload = { userId: "demo_user", mode, pairs: queue, settings };
    const { packId } = await api.orchestratePack(payload);
    toast.success("Pack creato — in elaborazione");
    onSubmitted(packId);
  };

  return (
    <div className="space-y-6">
      <Stepper step={step} />

      {step === 0 && (
        <div className="space-y-4">
          <StepMode value={mode} onChange={setMode} />
          <div className="flex justify-end">
            <Button onClick={() => setStep(1)} disabled={!mode}>Continua</Button>
          </div>
        </div>
      )}

      {step === 1 && mode && (
        <StepInputs
          mode={mode}
          onQueueCalculated={setQueue}
          settings={settings}
          onSettingsChange={setSettings}
          onBack={() => setStep(0)}
          onNext={() => setStep(2)}
        />
      )}

      {step === 2 && (
        <StepReview
          queue={queue}
          settings={settings}
          onBack={() => setStep(1)}
          onGenerate={handleGenerate}
        />
      )}
    </div>
  );
}