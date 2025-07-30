# Fase 3 – Controllo Qualità e Finitura: Analisi e Upscaling

**Autore:** Mira AI
**Versione:** 1.0 (31 Luglio 2024)
**Scopo:** Questo documento fornisce una descrizione tecnica granulare dei processi della **Fase 3**, il cui obiettivo è convertire le pose generate nella Fase 2 in asset intelligenti: immagini ad alta risoluzione corredate da metadati strutturati che alimentano la logica di Virtual Try On (VTO).

## 1. Missione e Flussi di Lavoro

La missione della Fase 3 è trasformare le immagini grezze in dati utilizzabili. Si divide in due flussi di lavoro indipendenti:

1.  **Analisi Automatica delle Pose:** Un processo obbligatorio che si attiva subito dopo la generazione di ogni posa. Un'AI multimodale analizza l'immagine e produce un report JSON che descrive l'inquadratura e l'indumento, verificando se coincide con quello del modello base.
2.  **Upscaling:** Un processo opzionale e avviato dall'utente che produce immagini ad alta risoluzione adatte alla pubblicazione e all'uso nel VTO.

---

## 2. Componenti di Sistema e Interazioni

| Componente | Tipo | Responsabilità Principale in Fase 3 |
| :--- | :--- | :--- |
| **`mira-agent-model-generation-jobs`** | Tabella DB | Mantiene lo stato completo del job, inclusi i risultati dell'analisi e lo stato dell'upscaling per ogni posa. |
| **`MIRA-AGENT-poller-model-generation`** | Edge Function | Orchestratore dell'upscaling. Monitora lo stato dei job di ComfyUI. |
| **`MIRA-AGENT-analyzer-pose-image`** | Edge Function | Esegue l'analisi visiva di una singola posa e aggiorna il database con i risultati. |
| **`MIRA-AGENT-start_poses_upscaling`** | Funzione RPC | Avvia il processo di upscaling aggiornando lo stato del job nel database e attivando il poller. |

---

## 3. Flusso 1: Analisi Automatica (`MIRA-AGENT-analyzer-pose-image`)

Questo processo arricchisce ogni posa generata con metadati essenziali.

1.  **Trigger:** Nella Fase 2, quando una posa passa dallo stato `processing` a `analyzing`, il poller invoca questa funzione. La chiamata è **"fire-and-forget"**: il poller non attende il completamento dell'analisi.

2.  **Input:** Riceve un oggetto JSON con:
    *   `job_id`: L'ID del job principale.
    *   `image_url`: L'URL dell'immagine della posa appena generata.
    *   `base_model_image_url`: L'URL dell'immagine del modello base con il completo neutro.

3.  **Preparazione:** Scarica entrambe le immagini e costruisce un `contents` array multimodale per l'API di generazione di contenuti (es. Gemini Vision). Il `systemPrompt` impartisce istruzioni precise su cosa estrarre: tipo di inquadratura, descrizione del capo, copertura e confronto con il modello base.

4.  **Analisi:** Effettua una chiamata a un modello LLM multimodale. Il `systemPrompt` vieta qualsiasi altro output che non sia un oggetto JSON con la seguente struttura:
    ```json
    {
      "shoot_focus": "upper_body | lower_body | full_body",
      "garment": {
        "description": "...descrizione concisa del capo...",
        "coverage": "upper_body | lower_body | full_body",
        "is_identical_to_base_garment": true | false
      }
    }
    ```

5.  **Aggiornamento del Database:** La funzione aggiorna il record corrispondente nella tabella `mira-agent-model-generation-jobs`:
    *   Individua l'oggetto della posa all'interno dell'array `final_posed_images` usando `image_url`.
    *   Inserisce il report JSON nel campo `analysis` della posa.
    *   Imposta `status='complete'` per quella posa. L’aggiornamento è atomico per evitare condizioni di gara.

---

## 4. Flusso 2: Upscaling (Avviato dall'Utente)

Questo processo è interamente guidato dall'utente e orchestrato dal poller.

1.  **Interfaccia Utente:** L'utente apre la modale "Upscale Poses" dal pannello di dettaglio del pack. Vengono mostrate tutte le pose con `status='complete'` e `is_upscaled=false`. L'utente seleziona le pose e un fattore di upscaling, generando un array di URL (`p_pose_urls`).

2.  **Chiamata RPC `MIRA-AGENT-start_poses_upscaling`:** Questa funzione, eseguita nel database (non come Edge Function), effettua:
    *   **Verifica Autorizzazioni:** Controlla che `auth.uid()` corrisponda al `user_id` del job.
    *   **Marcatura delle Pose:** Percorre l'array `final_posed_images`. Per ogni oggetto la cui `final_url` è presente in `p_pose_urls`, aggiunge i campi `upscale_status='pending'` e `upscale_factor`.
    *   **Cambio di Stato:** Imposta lo `status` del job principale su `'upscaling_poses'` e aggiorna la colonna `final_posed_images` con le modifiche.
    *   **Attivazione del Poller:** Invoca il poller con l'ID del job per avviare immediatamente la logica di upscaling.

3.  **Elaborazione nel Poller (`MIRA-AGENT-poller-model-generation`):**
    Quando il poller rileva `status='upscaling_poses'`, esegue il seguente ciclo per ogni posa con `upscale_status='pending'`:
    1.  **Preparazione Asset:** Scarica l'immagine dal `final_url`.
    2.  **Caricamento a ComfyUI:** Carica l'immagine sul server ComfyUI tramite l'endpoint `/upload/image`.
    3.  **Costruzione Workflow:** Genera un workflow JSON (es. `tiled_upscaler`) che aumenta la risoluzione e affina i dettagli.
    4.  **Avvio Job:** Invia il workflow a ComfyUI tramite `/prompt` e ottiene un `upscale_prompt_id`.
    5.  **Aggiornamento Record:** Salva `upscale_prompt_id` e imposta `upscale_status='processing'` per la posa.

4.  **Polling e Completamento:**
    *   Nei cicli successivi, il poller contatta `/history/{upscale_prompt_id}` per verificare il completamento.
    *   Se completato, scarica l'immagine upscalata, la carica su Supabase Storage e **sostituisce il `final_url`** con il nuovo URL ad alta risoluzione.
    *   Imposta `is_upscaled=true` e `upscale_status='complete'`.
    *   Quando tutte le pose marcate sono `complete`, il poller imposta lo `status` del job principale a `'complete'`.

---

## 5. Struttura Dati Finale

L'array `final_posed_images` centralizza tutte le informazioni. Ecco l'evoluzione di un singolo oggetto Posa attraverso la Fase 3.

**Dopo la Fase 2 (Input per la Fase 3):**
```json
{
  "pose_prompt": "walking towards camera",
  "comfyui_prompt_id": "...",
  "status": "complete",
  "final_url": "https://.../low_res_pose.png",
  "is_upscaled": false
}
```

**Dopo l'Analisi Automatica:**
```json
{
  "pose_prompt": "walking towards camera",
  "comfyui_prompt_id": "...",
  "status": "complete",
  "final_url": "https://.../low_res_pose.png",
  "is_upscaled": false,
  "analysis": {
    "shoot_focus": "full_body",
    "garment": {
      "description": "simple grey underwear and bra",
      "coverage": "full_body",
      "is_identical_to_base_garment": true
    }
  }
}
```

**Dopo l'Upscaling (Stato Finale):**
```json
{
  "pose_prompt": "walking towards camera",
  "comfyui_prompt_id": "...",
  "status": "complete",
  "final_url": "https://.../HIGH_RES_UPSCALED.png",
  "is_upscaled": true,
  "analysis": { ... },
  "upscale_status": "complete",
  "upscale_prompt_id": "...",
  "upscale_factor": 1.5
}
```

---

## 6. Punti Chiave

*   **Distinzione dei Processi:** L'analisi e l'upscaling sono due flussi di lavoro completamente separati con trigger e scopi diversi.
*   **Analisi Automatica:** L'analisi è un arricchimento di metadati automatico e obbligatorio per ogni posa generata.
*   **Upscaling Opzionale:** L'upscaling è un'azione opzionale, controllata dall'utente, che modifica l'asset immagine principale (`final_url`).
*   **Fonte Unica di Verità:** L'array `final_posed_images` agisce come una micro-macchina a stati per ogni posa, centralizzando tutte le informazioni necessarie al poller e all'interfaccia utente.

---