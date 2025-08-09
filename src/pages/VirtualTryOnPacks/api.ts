import { PackSummary, OrchestratorPayload } from './types';

// In-memory DB for mock data
const packsDb: Record<string, PackSummary> = {};
const packThumbs: Record<string, string[]> = {};
const logListeners: Record<string, Set<(line: string) => void>> = {};

type Listener = (p: PackSummary) => void;
const listeners = new Set<Listener>();

function emit(p: PackSummary) { listeners.forEach((cb) => cb(p)); }

function addLog(packId: string, line: string) {
  if (!logListeners[packId]) logListeners[packId] = new Set();
  for (const cb of logListeners[packId]) cb(line);
}

export const api = {
  async orchestratePack(payload: OrchestratorPayload): Promise<{ packId: string }> {
    const id = `pack_${Math.random().toString(36).slice(2, 9)}`;
    const name = `${payload.mode} Batch · ${new Date().toLocaleDateString()}`;
    const total = payload.pairs.length;
    packsDb[id] = { id, name, createdAt: new Date().toISOString(), total, success: 0, failed: 0, inProgress: total, hasReport: false };
    packThumbs[id] = payload.pairs.slice(0, 12).map(p => p.garment.imageUrl);

    // Simulate background processing
    let processed = 0;
    const interval = setInterval(() => {
      const p = packsDb[id];
      if (!p) { clearInterval(interval); return; }
      const chunk = Math.min(5, p.inProgress);
      p.inProgress -= chunk;
      const ok = Math.max(0, Math.min(chunk, chunk - Math.floor(Math.random() * 2)));
      const ko = chunk - ok;
      p.success += ok;
      p.failed += ko;
      emit({ ...p });
      addLog(id, `[${new Date().toLocaleTimeString()}] Processed ${ok + ko} (OK ${ok}, KO ${ko})`);
      processed += chunk;
      if (processed >= p.total) {
        clearInterval(interval);
        p.hasReport = true;
        emit({ ...p });
        addLog(id, `[${new Date().toLocaleTimeString()}] Pack complete. Report available.`);
      }
    }, 1000);

    emit({ ...packsDb[id] });
    return { packId: id };
  },
  async listPacks(): Promise<PackSummary[]> {
    return Object.values(packsDb).sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
  },
  subscribe(cb: Listener) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  subscribeLog(packId: string, cb: (line: string) => void) {
    if (!logListeners[packId]) logListeners[packId] = new Set();
    logListeners[packId].add(cb);
    return () => logListeners[packId].delete(cb);
  },
  async getPackThumbs(packId: string): Promise<string[]> { return packThumbs[packId] || []; },
  async retryIncomplete(packId: string) {
    const p = packsDb[packId]; if (!p) return;
    if (p.inProgress === 0 && p.failed === 0) { return; }
    const retry = p.failed; p.inProgress += retry; p.failed = 0; emit({ ...p }); addLog(packId, `Restarting ${retry} incomplete jobs...`);
  },
  async analyzePack(packId: string) { addLog(packId, "QA Analysis started..."); },
  async refinePack(packId: string) { addLog(packId, "Refinement pack created..."); },
  async downloadPack(packId: string) { addLog(packId, "Exporting ZIP..."); },
  openReport(packId: string) { alert(`Opening report for ${packId}`); }
};