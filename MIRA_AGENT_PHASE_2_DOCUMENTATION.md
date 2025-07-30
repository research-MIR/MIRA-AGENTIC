# Fase 2 – Generazione del Modello (Poller): Analisi Tecnica Dettagliata

**Autore:** Mira AI
**Versione:** 1.1 (31 Luglio 2024)
**Scopo:** Questo documento fornisce una descrizione tecnica granulare del poller di **Fase 2** (`MIRA-AGENT-poller-model-generation`), dettagliando ogni stato, manipolazione dei dati e interazione con altri servizi. È destinato a sviluppatori e architetti di sistema.

## 1. Missione e Confini della Fase 2

La missione della Fase 2 è duplice:
1.  **Progettare e Produrre il Modello Base:** Tradurre la descrizione testuale di un modello in un'immagine fotorealistica di alta qualità.
2.  **Coreografare e Avviare la Generazione delle Pose:** Utilizzare il modello base approvato per avviare la generazione di tutte le pose richieste.

I confini di questa fase sono netti: la responsabilità della Fase 2 termina nel momento in cui tutti i job di generazione delle pose sono stati **inviati con successo a ComfyUI**. Il monitoraggio del loro completamento, l'analisi e l'upscaling sono compiti esclusivi della **Fase 3**.

---

## 2. Componenti di Sistema e Interazioni

| Componente | Tipo | Responsabilità Principale in Fase 2 |
| :--- | :--- | :--- |
| **`mira-agent-model-generation-jobs`** | Tabella DB | Mantiene lo stato completo del job, agendo come "cervello" del processo. |
| **`MIRA-AGENT-poller-model-generation`** | Edge Function | Orchestratore principale della Fase 2. Esegue la logica della macchina a stati. |
| **`MIRA-AGENT-tool-generate-model-prompt`** | Edge Function | Converte le descrizioni utente in un prompt tecnico dettagliato per il modello base. |
| **`MIRA-AGENT-tool-generate-image-google`** | Edge Function | Genera le 4 immagini candidate per il modello base. |
| **`MIRA-AGENT-tool-quality-assurance-model`** | Edge Function | Analizza i 4 candidati, seleziona il migliore e ne determina il genere. |
| **`MIRA-AGENT-tool-comfyui-pose-generator`** | Edge Function | **Contiene lo "Smart Job Decider"**. Classifica l'intento e genera una singola posa. |
| **`MIRA-AGENT-analyzer-pose-image`** | Edge Function | Analizza una posa generata per estrarne gli attributi (es. `shoot_focus`). |

---

## 3. Flusso Dettagliato degli Stati

Il poller opera come una macchina a stati, leggendo lo `status` del job dal database e agendo di conseguenza.

### 3.1 `pending` – Progettazione del Modello Base

1.  **Input:** Legge `model_description` e `set_description` dal record del job.
2.  **Azione 1 (Prompt Engineering):** Chiama `MIRA-AGENT-tool-generate-model-prompt`.
    *   **Input:** `{ model_description, set_description }`
    *   **Output:** Una stringa `final_prompt` altamente dettagliata.
3.  **Azione 2 (Generazione):** Chiama `MIRA-AGENT-tool-generate-image-google`.
    *   **Input:** `{ prompt: final_prompt, number_of_images: 4, ... }`
    *   **Output:** Un array di 4 oggetti immagine `[{ id: '...', url: '...' }, ...]`.
4.  **Manipolazione Dati:**
    *   Scrive l'array di oggetti nel campo `base_generation_results` (JSONB).
    *   Aggiorna lo `status` a `'base_generation_complete'`.
5.  **Transizione:** Si auto-invoca per il ciclo successivo.

### 3.2 `base_generation_complete` – Selezione e QA del Modello Base

*   **Se `auto_approve = true`:**
    1.  **Azione (QA):** Chiama `MIRA-AGENT-tool-quality-assurance-model`.
        *   **Input:** `{ image_urls: [...] }` (da `base_generation_results`), `model_description`, `final_generation_prompt`.
        *   **Output:** Un oggetto JSON `{ "best_image_index": <number>, "gender": "male" | "female" }`.
    2.  **Manipolazione Dati:**
        *   Usa `best_image_index` per estrarre l'URL dell'immagine migliore dall'array `base_generation_results`.
        *   Scrive l'URL nel campo `base_model_image_url`.
        *   Scrive il valore `gender` nel campo `gender`.
    3.  **Aggiorna lo stato** a `'generating_poses'`.
    4.  **Transizione:** Si auto-invoca.
*   **Se `auto_approve = false`:**
    1.  **Azione:** Imposta lo `status` a `'awaiting_approval'`.
    2.  **Transizione:** Il ciclo si ferma. Attende un intervento esterno (dall'UI) che modificherà lo stato.

### 3.3 `generating_poses` – Coreografia e Avvio delle Pose

Questo è il passaggio finale e più complesso della Fase 2.

1.  **Crea Placeholder Posa Base:** Inserisce in `final_posed_images[0]` un oggetto JSON strutturato:
    ```json
    {
      "pose_prompt": "Neutral A-pose, frontal",
      "comfyui_prompt_id": null,
      "status": "analyzing",
      "final_url": "<base_model_image_url>",
      "is_upscaled": false,
      "analysis_started_at": "2024-07-30T10:00:00Z"
    }
    ```
2.  **Avvia Analisi Posa Base:** Esegue una chiamata asincrona (fire-and-forget) a `MIRA-AGENT-analyzer-pose-image` per la posa base.
3.  **Crea Placeholder Altre Pose:** Per ogni `pose_prompt` fornito dall'utente, popola l'array `final_posed_images` con oggetti placeholder:
    ```json
    {
      "pose_prompt": "...",
      "comfyui_prompt_id": null,
      "status": "pending",
      "final_url": null,
      "is_upscaled": false
    }
    ```
4.  **Avvia Generazioni in Parallelo:** Esegue un `Promise.allSettled` per chiamare `MIRA-AGENT-tool-comfyui-pose-generator` per ogni posa `pending`.
5.  **Aggiornamento Atomico (eseguito dal tool, non dal poller):** Ogni istanza di `...-pose-generator`, una volta ricevuto il `prompt_id` da ComfyUI, aggiorna il proprio oggetto Posa nell'array `final_posed_images` tramite una funzione RPC (`update_pose_with_prompt_id`), impostando `comfyui_prompt_id` e cambiando lo `status` in `'processing'`.
6.  **Transizione di Stato Finale:** Dopo che tutte le chiamate a `...-pose-generator` sono state inviate, il poller imposta lo `status` del job principale a `'polling_poses'`. **La sua responsabilità termina qui.**

---

## 4. Deep Dive: Il Motore di Triage ("Smart Job Decider")

Il "Smart Job Decider" non è un'entità separata, ma è la **logica di triage implementata all'interno del tool `MIRA-AGENT-tool-comfyui-pose-generator`**. Il suo scopo è classificare l'intento dell'utente per ogni singola posa richiesta.

| Componente | `MIRA-AGENT-tool-comfyui-pose-generator` |
| :--- | :--- |
| **Trigger** | Chiamato dal poller durante lo stato `generating_poses`. |
| **Scopo** | Orchestrare la generazione di una singola posa, decidendo se si tratta di un cambio di posa, di un cambio di indumento o di entrambi. |

### Flusso Logico del Triage:

1.  **Input:** Riceve il `pose_prompt` dell'utente (es. "in piedi, con una giacca rossa").
2.  **Azione 1 (Classificazione):** Chiama un sub-servizio AI (`MIRA-AGENT-tool-triage-pose-request`) con il `pose_prompt`.
    *   **Output del Triage:** Un JSON che classifica l'intento: `{ "task_type": "both", "garment_description": "a red jacket" }`.
3.  **Azione 2 (Selezione del Prompt di Sistema):** In base al `task_type`, il tool seleziona il System Prompt corretto per il passo successivo:
    *   `task_type: 'pose'` -> Usa `POSE_CHANGE_SYSTEM_PROMPT`.
    *   `task_type: 'garment'` -> Usa `GARMENT_SWAP_SYSTEM_PROMPT`.
    *   `task_type: 'both'` -> Usa un workflow a due passaggi, iniziando con `POSE_CHANGE_SYSTEM_PROMPT`.
4.  **Azione 3 (Generazione del Prompt Finale):** Chiama Gemini con il System Prompt selezionato, le immagini di riferimento e il `pose_prompt` per generare il prompt tecnico finale per ComfyUI.
5.  **Azione 4 (Invio a ComfyUI):** Invia il workflow a ComfyUI e ottiene un `comfyui_prompt_id`.
6.  **Azione 5 (Aggiornamento DB):** Chiama la funzione RPC `update_pose_with_prompt_id` per aggiornare il record del job nel database.

---

## 5. Strutture Dati e Manipolazione

La colonna più importante è `final_posed_images` (JSONB) nella tabella `mira-agent-model-generation-jobs`. La sua struttura evolve durante la Fase 2.

**Stato Iniziale (dopo `generating_poses`):**
```json
[
  {
    "pose_prompt": "Neutral A-pose, frontal",
    "status": "analyzing",
    "final_url": "...",
    "is_upscaled": false,
    "analysis_started_at": "..."
  },
  {
    "pose_prompt": "walking towards camera",
    "comfyui_prompt_id": "...",
    "status": "processing",
    "final_url": null,
    "is_upscaled": false
  }
]
```

**Stato Finale (pronto per la Fase 3):**
Tutti gli oggetti Posa avranno un `comfyui_prompt_id` e uno `status` di `'processing'` (o `'analyzing'` per la posa base). La Fase 3 monitorerà questi `comfyui_prompt_id` per determinare quando le immagini sono pronte.

---

## 6. Error Handling e Resilienza

*   **Watchdog:** Se un job rimane in uno stato di elaborazione (`pending`, `base_generation_complete`, `generating_poses`) per più di `X` secondi, il watchdog lo riavvia.
*   **Retry Logic:** I tool di generazione e analisi contengono logiche di retry interne per gestire fallimenti temporanei delle API esterne.
*   **Idempotenza:** Il poller è progettato per essere idempotente. Se viene riavviato su uno stato già completato, non eseguirà nuovamente le azioni, ma passerà allo stato successivo.

---