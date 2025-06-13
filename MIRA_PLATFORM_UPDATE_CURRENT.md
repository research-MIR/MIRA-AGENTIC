**Oggetto:** Aggiornamento Piattaforma: Integrazione ComfyUI e Modifiche al Flusso di Lavoro

Questo documento descrive gli aggiornamenti tecnici e funzionali della piattaforma Mira.

### 1. Modifica Architetturale Principale: Integrazione di ComfyUI

-   **Cos'è:** È stato integrato un nuovo backend per l'elaborazione di immagini basato su nodi, chiamato ComfyUI.
-   **Scopo:** Abilita workflow di manipolazione delle immagini complessi e multi-stadio. Questa tecnologia è il motore della nuova funzionalità "Rifinisci e Migliora".

### 2. Nuova Funzionalità: Pagina "Rifinisci e Migliora"

-   **Posizione:** Nuova voce nella barra laterale.
-   **Funzionalità:**
    -   Caricamento di un'immagine sorgente (generata o esterna).
    -   Input di un prompt testuale per descrivere le modifiche desiderate.
    -   Controllo del fattore di upscaling tramite slider.
    -   Confronto interattivo "prima/dopo" al termine del processo.
-   **Processo:** I job di affinamento sono asincroni e possono essere monitorati tramite l'Active Jobs Tracker.

### 3. Modifiche al Flusso di Lavoro e ai Modelli

-   **"Pipeline Mode" Rimossa:** La precedente "Pipeline Mode" (On/Off/Auto) è stata rimossa. Il processo a due fasi (generazione + affinamento) è ora un flusso di lavoro manuale e intenzionale gestito dall'utente.
-   **Modello OpenAI Rimosso:** La piattaforma è stata standardizzata per utilizzare Google Imagen per la generazione di base e il backend ComfyUI/Fal.ai per l'affinamento e i task creativi.

### 4. Aggiornamento della Galleria

-   **Nuovi Filtri:** La Galleria ora include filtri per visualizzare le immagini in base alla loro origine: `Agent`, `Direct` (Generatore Diretto), e `Refined` (Affinati).

### Flusso di Lavoro Consigliato

1.  **Creazione:** Utilizzare l'Agent Chat o il Direct Generator per creare un'immagine base.
2.  **Selezione:** Scegliere il risultato migliore dalla generazione iniziale.
3.  **Affinamento:** Portare l'immagine selezionata nella pagina "Refine & Upscale" per applicare miglioramenti specifici o per eseguire un upscaling di alta qualità.