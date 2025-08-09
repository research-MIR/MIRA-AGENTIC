import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { PackSummary } from '../types';
import { api } from '../api';
import { PackRowActions } from './PackRowActions';
import { PackDetailDrawer } from './PackDetailDrawer';

const fmt = new Intl.NumberFormat("it-IT");
const pct = (n: number) => Math.max(0, Math.min(100, n));

function StatusBar({ p }: { p: PackSummary }) {
  const done = p.success + p.failed;
  const progress = p.total ? (done / p.total) * 100 : 0;
  return (
    <div>
      <Progress value={pct(progress)} className="h-2" />
      <div className="mt-1 text-xs text-muted-foreground flex items-center gap-2">
        <span>{fmt.format(done)}/{fmt.format(p.total)}</span>
        <Badge variant="outline">OK {fmt.format(p.success)}</Badge>
        <Badge variant="destructive">KO {fmt.format(p.failed)}</Badge>
      </div>
    </div>
  );
}

export function JobsTable() {
  const [packs, setPacks] = useState<PackSummary[]>([]);
  const [drawerPack, setDrawerPack] = useState<PackSummary | null>(null);

  useEffect(() => {
    let mounted = true;
    api.listPacks().then(ps => mounted && setPacks(ps));
    const unsub = api.subscribe((updated) => {
      setPacks(prev => prev.map(p => p.id === updated.id ? updated : p));
    });
    return () => { mounted = false; unsub(); };
  }, []);

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Job Recenti</CardTitle>
          <CardDescription>Stato dei pack generati in background</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pack</TableHead>
                <TableHead>Creato il</TableHead>
                <TableHead>Avanzamento</TableHead>
                <TableHead>Ultimo aggiornamento</TableHead>
                <TableHead className="text-right">Azioni</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {packs.map(p => (
                <TableRow key={p.id} className="cursor-pointer" onClick={() => setDrawerPack(p)}>
                  <TableCell className="font-medium">{p.name}</TableCell>
                  <TableCell>{new Date(p.createdAt).toLocaleString()}</TableCell>
                  <TableCell><StatusBar p={p} /></TableCell>
                  <TableCell>{p.inProgress > 0 ? `${p.inProgress} in corso` : "-"}</TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    <PackRowActions pack={p} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <PackDetailDrawer pack={drawerPack} isOpen={!!drawerPack} onClose={() => setDrawerPack(null)} />
    </>
  );
}