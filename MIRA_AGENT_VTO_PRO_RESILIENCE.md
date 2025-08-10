# Nota di monitoraggio — Resilienza della pipeline VTO Pro (Inpaint)

**Stato:** Monitoraggio (non una limitazione aperta o bug). La pipeline è funzionante; i meccanismi di resilienza coprono la grande maggioranza dei casi. Manteniamo vigilanza operativa e miglioramenti proattivi.

**Executive summary (contesto)**
La pipeline VTO Pro è un workflow AI multi-stadio. La presenza di fallimenti transitori e di errori recuperabili è caratteristica dei sistemi multi-agente, non un difetto architetturale. L’assetto attuale combina supervisione automatica, strumenti di recupero in UI e una fixer pipeline auto-correttiva, garantendo un’elevata percentuale di completamento dei job.

**Cosa monitoriamo**
*   **Stuck jobs (transitori):** Job bloccati in stati intermedi (`processing`, `segmenting`, etc.) a causa di micro-interruzioni di rete, 503 temporanei (BitStudio/ComfyUI), o cold start lenti.
*   **Failed jobs (recuperabili):** Job che terminano con uno stato di `failed` a causa di errori recuperabili, come una risposta malformata dall’analyzer o errori nel compositing finale.

**Resilienza attuale (in produzione)**

*   **Layer 1 — Watchdogs:** `MIRA-AGENT-watchdog-background-jobs` rileva i job bloccati e li riavvia o li resetta a uno stato sicuro.

*   **Layer 2 — Strumenti UI (Pagina Virtual Try-On Packs):** Questi strumenti, accessibili dall'accordion di ogni pack, permettono un intervento manuale mirato.
    *   **Restart Incomplete →** Chiama la RPC **`MIRA-AGENT-retry-all-incomplete-in-pack`**. Questa è un'azione "forza bruta" che prende **tutti** i job non ancora `complete` (quindi `pending`, `processing`, `failed`, etc.) e li resetta allo stato `pending` per un nuovo tentativo.
    *   **Refine Pack →** Chiama la Edge Function **`MIRA-AGENT-orchestrator-vto-refinement-pass`**. Questa funzione ha un duplice scopo:
        *   **Miglioramento:** Se l'utente sceglie lo scope "successful only", crea un nuovo pack per migliorare la qualità delle immagini già riuscite.
        *   **Correzione (il "Create Corrected Batch"):** Se l'utente sceglie lo scope "all completed", la funzione crea un nuovo pack che include anche i job falliti, permettendo di eseguire un secondo pass di inpainting su di essi nel tentativo di correggerli.

*   **Layer 3 — Fixer pipeline:** Lo stato `awaiting_fix` attiva `MIRA-AGENT-fixer-orchestrator`, che tenta una correzione automatica basata sul report QA.

**Riferimenti rapidi**
*   **Segmentation:** `MIRA-AGENT-orchestrator-segmentation` → `mira-agent-mask-aggregation-jobs` → `MIRA-AGENT-worker-segmentation` (×N) → `MIRA-AGENT-compositor-segmentation` → `MIRA-AGENT-expander-mask`.
*   **Inpaint:** `MIRA-AGENT-worker-batch-inpaint` → `MIRA-AGENT-worker-batch-inpaint-step2` → `MIRA-AGENT-proxy-bitstudio` (mode:"inpaint") → `MIRA-AGENT-poller-bitstudio` → `MIRA-AGENT-compositor-inpaint`.
*   **Tabelle:** `mira-agent-bitstudio-jobs`, `mira-agent-batch-inpaint-pair-jobs`, `mira-agent-mask-aggregation-jobs`, `mira-agent-vto-qa-reports`.

**Aree di attenzione (monitoraggio)**
*   Dipendenza dalla qualità della segmentazione.
*   Stato distribuito su molte funzioni (hand-off/timeout).

**Direzioni future (proattive, non urgenti)**
*   Hardening della Segmentation.
*   Semplificazione con una state machine centralizzata.
*   Dashboard di monitoring & analytics.