# Documentazione Tecnica delle Tabelle del Mira Agent

Questo documento fornisce un'analisi dettagliata di ogni tabella che costituisce il nucleo del sistema Mira Agent. Per ogni tabella, viene descritto lo scopo, un'analisi di ogni colonna, quali Edge Function interagiscono con essa e un esempio del ciclo di vita dei dati.

---

## 1. `mira-agent-jobs`

Questa è la tabella più importante del sistema; agisce come il "cervello" o la macchina a stati centrale per ogni richiesta dell'utente.

-   **Scopo Generale:** Tracciare l'intero ciclo di vita di un'attività dell'agente, dalla richiesta iniziale dell'utente al risultato finale. Mantiene lo stato, la cronologia della conversazione e i risultati intermedi, consentendo all'agente di eseguire piani complessi e asincroni su più passaggi.

-   **Analisi delle Colonne:**
    -   `id` (uuid): La chiave primaria univoca per ogni job.
    -   `created_at` (timestamp): Registra quando il job è stato creato per la prima volta.
    -   `updated_at` (timestamp): Aggiornato automaticamente ogni volta che il job viene modificato. È fondamentale per il `watchdog` per identificare i job bloccati.
    -   `status` (text): Lo stato attuale del job. Valori comuni includono `pending`, `processing`, `complete`, `failed`, `awaiting_feedback`.
    -   `original_prompt` (text): La richiesta testuale iniziale dell'utente. Viene talvolta sovrascritta dalla funzione `MIRA-AGENT-tool-generate-chat-title` per creare un titolo più conciso per la cronologia della chat.
    -   `context` (jsonb): Il campo più critico. È un oggetto JSON che funge da memoria a breve termine del job. Contiene:
        -   `history`: Un array dell'intera conversazione tra l'utente e l'agente, incluse le chiamate agli strumenti e le loro risposte.
        -   `iteration_number`: Un contatore per i cicli di auto-correzione (es. prompt -> generazione -> critica).
        -   `isDesignerMode`, `pipelineMode`, `selectedModelId`: Impostazioni della UI che influenzano il comportamento dell'agente.
        -   `user_provided_assets`: Un manifest dei file caricati dall'utente.
    -   `final_result` (jsonb): Una volta che il job è `complete`, questo campo contiene l'output finale formattato per essere visualizzato dall'interfaccia utente.
    -   `error_message` (text): Se lo stato è `failed`, questo campo contiene il messaggio di errore che ha causato l'interruzione del job.
    -   `user_id` (uuid): Una chiave esterna che collega il job all'utente che lo ha avviato.

-   **Edge Function Interagenti:**
    -   **`MIRA-AGENT-master-worker`**: La funzione principale che legge e scrive costantemente su questa tabella per eseguire il suo piano.
    -   **`MIRA-AGENT-continue-job`**: Aggiorna il `context` con il nuovo input dell'utente e imposta lo `status` su `processing` per riattivare il `master-worker`.
    -   **`MIRA-AGENT-watchdog`**: Interroga questa tabella per trovare job con `status = 'processing'` che non sono stati aggiornati per un certo periodo e li riavvia.
    -   **`MIRA-AGENT-tool-generate-chat-title`**: Aggiorna il campo `original_prompt` dopo la creazione del job.

-   **Esempio di Dati del Ciclo di Vita:**

    **Stato Iniziale (al momento della creazione):**
    ```json
    {
      "id": "a1b2c3d4-...",
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T12:00:00Z",
      "status": "processing",
      "original_prompt": "A cat wearing a wizard hat",
      "context": {
        "history": [
          {
            "role": "user",
            "parts": [{ "text": "A cat wearing a wizard hat" }]
          }
        ],
        "iteration_number": 1,
        "isDesignerMode": true,
        "pipelineMode": "auto",
        "selectedModelId": "gpt-image-1"
      },
      "final_result": null,
      "error_message": null,
      "user_id": "e5f6g7h8-..."
    }
    ```

    **Stato Finale (dopo il completamento):**
    ```json
    {
      "id": "a1b2c3d4-...",
      "created_at": "2024-01-01T12:00:00Z",
      "updated_at": "2024-01-01T12:05:00Z",
      "status": "complete",
      "original_prompt": "Cat in a Wizard Hat",
      "context": {
        "history": [
          { "role": "user", "parts": [...] },
          { "role": "model", "parts": [{ "functionCall": { "name": "dispatch_to_artisan_engine", "args": {...} } }] },
          { "role": "function", "parts": [{ "functionResponse": { "name": "dispatch_to_artisan_engine", "response": {...} } }] },
          { "role": "model", "parts": [{ "functionCall": { "name": "generate_image", "args": {...} } }] },
          { "role": "function", "parts": [{ "functionResponse": { "name": "generate_image", "response": {...} } }] }
        ],
        "iteration_number": 1,
        "isDesignerMode": true,
        "pipelineMode": "auto",
        "selectedModelId": "gpt-image-1"
      },
      "final_result": {
        "isCreativeProcess": true
      },
      "error_message": null,
      "user_id": "e5f6g7h8-..."
    }
    ```

---

## 2. `mira-agent-models`

Questa tabella funge da registro centrale per tutti i modelli di generazione di immagini disponibili nell'applicazione.

-   **Scopo Generale:** Permettere una selezione dinamica dei modelli nell'interfaccia utente e fornire all'agente i metadati necessari per invocare correttamente lo strumento di generazione appropriato.

-   **Analisi delle Colonne:**
    -   `id` (uuid): Chiave primaria.
    -   `model_id_string` (text): L'identificatore univoco del modello utilizzato nelle chiamate API (es. `gpt-image-1`, `fal-ai/flux-pro/v1.1-ultra`).
    -   `provider` (text): Il fornitore del modello (es. `OpenAI`, `Google`, `Fal.ai`). Questo è fondamentale per il `master-worker` per decidere quale Edge Function chiamare.
    -   `model_type` (text): Il tipo di modello (es. `image`).
    -   `is_default` (boolean): Indica se questo è il modello preselezionato per i nuovi utenti.
    -   `default_loras` (jsonb): Per i modelli che lo supportano (come Fal.ai), questo campo può contenere un array di LoRA da applicare di default.
    -   `supports_img2img` (boolean): Un flag che indica se il modello può essere utilizzato in un flusso image-to-image con un'immagine di riferimento.

-   **Edge Function Interagenti:**
    -   **`MIRA-AGENT-master-worker`**: Legge questa tabella per determinare il `provider` del modello selezionato e quindi invocare la funzione di generazione corretta.
    -   **`MIRA-AGENT-tool-generate-image-fal`**: Legge il campo `default_loras` per applicare i LoRA corretti durante la generazione.

-   **Stato Attuale dei Dati (Configurazione Richiesta):**
    ```json
    [
      {
        "id": "uuid-1",
        "model_id_string": "gpt-image-1",
        "provider": "OpenAI",
        "model_type": "image",
        "is_default": true,
        "default_loras": null,
        "supports_img2img": true
      },
      {
        "id": "uuid-2",
        "model_id_string": "imagen-4",
        "provider": "Google",
        "model_type": "image",
        "is_default": false,
        "default_loras": null,
        "supports_img2img": false
      },
      {
        "id": "uuid-3",
        "model_id_string": "fal-ai/flux-pro/v1.1-ultra",
        "provider": "Fal.ai",
        "model_type": "image",
        "is_default": false,
        "default_loras": null,
        "supports_img2img": false
      },
      {
        "id": "uuid-4",
        "model_id_string": "fal-ai/flux-pro/v1.1-ultra/redux",
        "provider": "Fal.ai",
        "model_type": "image",
        "is_default": false,
        "default_loras": null,
        "supports_img2img": true
      }
    ]
    ```

---

## 3. `mira-agent-config`

Una tabella semplice ma essenziale per la configurazione dinamica dell'agente.

-   **Scopo Generale:** Memorizzare le impostazioni di configurazione chiave-valore che possono essere modificate senza dover ridistribuire il codice delle Edge Function.

-   **Analisi delle Colonne:**
    -   `key` (text): Il nome della chiave di configurazione (es. `max_retries`).
    -   `value` (jsonb): Il valore associato alla chiave.
    -   `description` (text): Una spiegazione di cosa fa l'impostazione.

-   **Edge Function Interagenti:**
    -   Attualmente, nessuna delle funzioni fornite scrive o legge attivamente da questa tabella, ma è progettata per essere utilizzata da qualsiasi componente dell'agente che necessiti di parametri di configurazione dinamici.

-   **Esempio di Dati (Dati di Configurazione):**
    ```json
    {
      "id": "uuid-config-1",
      "key": "max_retries",
      "value": { "default": 3 },
      "description": "Maximum number of retries for a failed tool call."
    }
    ```

---

## 4. `mira-agent-artisan-diary` & `mira-agent-discriminator-diary`

Queste due tabelle hanno una struttura identica e servono a uno scopo simile per agenti diversi.

-   **Scopo Generale:** Fornire un log dettagliato e leggibile del "processo di pensiero" interno di un agente specializzato durante l'esecuzione di un job. Questo è uno strumento di debugging e analisi estremamente potente per capire perché un agente ha preso una determinata decisione.

-   **Analisi delle Colonne:**
    -   `id` (uuid): Chiave primaria.
    -   `job_id` (uuid): Collega questa voce di diario al job principale in `mira-agent-jobs`.
    -   `iteration_number` (integer): Indica a quale ciclo del processo di auto-correzione appartiene questa voce.
    -   `diary_entry_text` (text): Il testo effettivo del pensiero o della logica dell'agente in quel passaggio.

-   **Edge Function Interagenti:**
    -   **`MIRA-AGENT-tool-generate-image-prompt`** (Artisan) e **`MIRA-AGENT-tool-critique-images`** (Discriminator) producono un campo `diary_entry` nel loro output JSON. Il `master-worker` è responsabile di scrivere queste voci nelle rispettive tabelle.

-   **Esempio di Dati del Ciclo di Vita (`mira-agent-artisan-diary`):**

    **Voce per l'Iterazione 1:**
    ```json
    {
      "id": "diary-uuid-1",
      "job_id": "a1b2c3d4-...",
      "iteration_number": 1,
      "diary_entry_text": "Initial request analysis. The user provided a simple text brief. I will deconstruct the core elements and build a detailed photorealistic prompt.",
      "created_at": "2024-01-01T12:01:00Z"
    }
    ```

    **Voce per l'Iterazione 2 (dopo il feedback):**
    ```json
    {
      "id": "diary-uuid-2",
      "job_id": "a1b2c3d4-...",
      "iteration_number": 2,
      "diary_entry_text": "The Art Director rejected the first batch, noting the lighting was too bright. I will now refine the prompt to include 'dramatic, low-key lighting' and 'chiaroscuro' to address the feedback.",
      "created_at": "2024-01-01T12:04:00Z"
    }
    ```