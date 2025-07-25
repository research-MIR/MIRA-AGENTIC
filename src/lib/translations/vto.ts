export const vtoTranslations = {
  it: {
    proMode: "Modalità Pro",
    vtoDescription: "Una suite di strumenti per il camerino virtuale. Usa 'Prova Singola' per creazioni individuali dettagliate o 'Processo Multiplo' per generare più variazioni contemporaneamente.",
    noRecentJobsVTO: "Nessun job recente trovato per questa modalità.",
    singleVtoDescription: "Carica un'immagine di una persona e una di un indumento. L'IA può generare automaticamente un prompt per combinarli, oppure puoi scriverne uno tu.",
    personImage: "Immagine Persona",
    garmentImage: "Immagine Indumento",
    promptSectionTitle: "2. Prompt",
    promptOptional: "2. Prompt (Opzionale)",
    autoGenerate: "Auto-Genera",
    promptPlaceholderVTO: "Un prompt dettagliato apparirà qui...",
    generatingPrompt: "Generazione prompt in corso...",
    settingsSectionTitle: "3. Impostazioni",
    startVirtualTryOn: "Avvia Prova Virtuale",
    resultPlaceholder: "Il tuo risultato apparirà qui.",
    batchVtoDescription: "Crea in modo efficiente più immagini di prova contemporaneamente. Scegli un metodo di raggruppamento qui sotto.",
    batchMode: "Modalità Batch",
    chooseBatchMethod: "Scegli un metodo per l'elaborazione batch.",
    oneGarmentDescription: "Applica un singolo indumento a più persone. Utile per vedere come sta un articolo su modelli diversi.",
    uploadGarment: "Carica Indumento",
    uploadPeople: "Carica Persone",
    selectMultiplePersonImages: "Seleziona più immagini di persone.",
    randomPairsDescription: "Carica elenchi di persone e indumenti. Il sistema li abbinerà casualmente per creare combinazioni diverse.",
    precisePairsDescription: "Crea coppie specifiche di modelli e indumenti uno per uno per un controllo totale sull'output.",
    person: "Persona",
    garment: "Indumento",
    addPair: "Aggiungi Coppia",
    startBatchTryOn: "Avvia Prova Multipla",
    batchQueue: "Coda di Lavorazione",
    peopleCount: "Persone ({count})",
    garmentsCount: "Indumenti ({count})",
    proSettings: "3. Impostazioni PRO",
    workbenchDescription: "Carica un'immagine nel pannello 'Setup' per iniziare o seleziona un job recente per visualizzare il risultato.",
    uploadToBegin: "Carica un'immagine nel pannello 'Setup' per iniziare",
    orSelectRecent: "o seleziona un job recente per visualizzare il risultato",
    recentProJobs: "Job Recenti (PRO)",
    noRecentProJobs: "Nessun job PRO recente trovato.",
    denoiseStrength: "Intensità Denoise: {denoise}",
    maskExpansion: "Espansione Maschera: {maskExpansion}%",
    resetMask: "Resetta Maschera",
    singleTryOn: "Prova Singola",
    selectedJob: "Job Selezionato",
    recentJobs: "Job Recenti",
    oneGarment: "Un Indumento",
    randomPairs: "Coppie Casuali",
    uploadImages: "1. Carica Immagini",
    batchProcess: "Processo Multiplo",
    highResolution: "Alta Risoluzione",
    numberOfImages: "Numero di Immagini",
    jobFailed: "Job fallito: {errorMessage}",
    jobStatus: "Stato del job: {status}",
    vtoHelpTitle: "Guida al Camerino Virtuale",
    vtoHelpIntro: "Questa guida spiega le diverse modalità e impostazioni disponibili nella scheda Prova Virtuale.",
    vtoHelpSingleTitle: "Modalità Prova Singola",
    vtoHelpSingleDesc: "Questa è la modalità standard per generare un'immagine di prova. Carica un'immagine di una persona e un'immagine di un indumento. Puoi scrivere un prompt manualmente o usare l'opzione 'Auto-Genera' per far sì che l'IA crei un prompt dettagliato per te.",
    vtoHelpBatchTitle: "Modalità Processo Multiplo",
    vtoHelpBatchDesc: "Questa modalità è progettata per creare più immagini contemporaneamente in modo efficiente. Scegli tra tre metodi:",
    vtoHelpBatchOneGarment: "**Un Indumento:** Applica un singolo indumento a più persone. Ottimo per vedere la vestibilità su diversi modelli.",
    vtoHelpBatchRandom: "**Coppie Casuali:** Carica un gruppo di persone e un gruppo di indumenti. Il sistema li abbinerà casualmente.",
    vtoHelpBatchPrecise: "**Coppie Precise:** Crea coppie specifiche persona-indumento una per una per un controllo totale.",
    vtoHelpProTitle: "Modalità Pro (Inpainting)",
    vtoHelpProDesc: "La Modalità Pro ti dà un controllo a livello di pixel per sostituzioni di indumenti complesse. Invece di sostituire l'intero outfit, puoi 'dipingere' una maschera sull'area che vuoi modificare.",
    vtoHelpProMasking: "**Mascheratura:** Usa il pennello per disegnare sull'area dell'immagine sorgente che vuoi sostituire. Puoi regolare la dimensione del pennello per una maggiore precisione.",
    vtoHelpProReference: "**Immagine di Riferimento (Opzionale):** Fornisci un'immagine di un indumento o di una texture da applicare all'area mascherata. Se non viene fornita, l'IA riempirà l'area in base al prompt.",
    vtoHelpProSettings: "**Impostazioni Pro:** Controlla il numero di tentativi, la forza del 'denoise' (quanto l'IA si discosta dall'immagine originale) e l'espansione della maschera per una migliore fusione.",
    viewingJob: "Stai visualizzando un job completato. Clicca 'Nuovo' per iniziarne un altro.",
    proSettingsTooltip: "Clicca per sbloccare controlli avanzati per l'inpainting.",
    promptAppendix: "Appendice Prompt (Opzionale)",
    promptAppendixPlaceholder: "es. indossa jeans chiari, con i capelli raccolti",
    promptAppendixPair: "Istruzione Specifica per la Coppia",
    promptAppendixPairPlaceholder: "es. indossa jeans chiari",
    garmentMode: "Modalità Indumento",
    referenceImage: "Immagine di Riferimento",
    autoMask: "Maschera Automatica da Riferimento",
    singleInpaint: "Inpaint Singolo",
    batchInpaint: "Inpaint Multiplo",
    vtoProModeDescription: "Questa modalità PRO è specializzata per l'abbigliamento. Il sistema identificherà e applicherà automaticamente l'indumento di riferimento. Per mascheratura manuale e modifiche generiche, usa la pagina 'Inpainting'.",
    vtoProGuideTitle: "Guida alla Modalità Pro (Prova Virtuale)",
    vtoProGuideContent: `
### Come Funziona la Modalità Pro VTO

Questa modalità è uno strumento specializzato progettato per la **sostituzione di indumenti** ad alta fedeltà. Utilizza un'IA avanzata per identificare e scambiare automaticamente i vestiti. Ecco cosa devi sapere:

#### 1. La Mascheratura è Automatica
Questo strumento **rileva automaticamente l'indumento** da sostituire basandosi sulla tua immagine di riferimento. Non c'è un pennello manuale o uno strumento di mascheratura qui. Per un controllo manuale e preciso su qualsiasi parte di un'immagine, si prega di utilizzare la pagina dedicata **'Inpainting'**.

#### 2. È Guidata dal Riferimento
L'**Immagine di Riferimento** è la chiave. L'IA analizza l'indumento nella tua immagine di riferimento (es. una t-shirt, una scarpa, una borsa) e poi trova e sostituisce l'articolo corrispondente sulla persona nella tua **Immagine Sorgente**.
-   Un riferimento di una **scarpa** sostituirà le scarpe.
-   Un riferimento di una **camicia** sostituirà la camicia.

#### 3. Ideale per Indumenti Simili
Per i migliori risultati, usa questo strumento per scambiare tipi di abbigliamento simili. Per esempio:
-   Sostituire una t-shirt su un modello con un'altra t-shirt.
-   Cambiare la texture o il colore di una giacca esistente.
È meno efficace nel posizionare un indumento su una persona che indossa qualcosa di completamente diverso (es. mettere una t-shirt a un modello che indossa un ingombrante cappotto invernale).

#### 4. Un Capo alla Volta
Questo strumento elabora un indumento alla volta. Se hai bisogno di creare un outfit completo con più pezzi (es. una t-shirt e dei jeans), devi eseguire un processo iterativo (a più passaggi).
1.  Prima, esegui il processo con la persona e il riferimento della t-shirt.
2.  Poi, usa l'immagine risultante come nuova immagine sorgente ed esegui nuovamente il processo con il riferimento dei jeans.

#### 5. Impostazioni PRO Spiegate
- **Numero di Tentativi:** Genera più variazioni della stessa richiesta di inpainting. Utile per ottenere diverse interpretazioni dall'IA.
- **Alta Risoluzione:** Aumenta la risoluzione dell'output. Richiede più tempo ma produce risultati di qualità superiore.
- **Intensità Denoise:** Controlla la libertà creativa dell'IA. Un valore basso (es. 0.5) preserva la struttura originale, ideale per texture changes. Un valore alto (es. 0.9) permette all'IA di essere più creativa, utile per cambiare la forma di un indumento.
- **Espansione Maschera:** Ammorbidisce i bordi della maschera, creando una fusione più naturale tra l'area generata e l'immagine originale. Aumenta questo valore se noti bordi netti nel risultato.
`,
    vtoProGuidanceTitle: "Consiglio Rapido per Risultati Migliori",
    vtoProGuidanceContent: `
Prima di tentare di nuovo, controlla se il tuo lavoro appare nella lista dei "Job Recenti".

- **Se il risultato non è buono**, prova a disattivare l'interruttore "Assistente Prompt AI" e riprova.
- **Se dopo altri 2-3 tentativi non funziona ancora**, fermati e chiedi assistenza.

**Nota:** Il job potrebbe apparire nella lista dei "Job Recenti" anche dopo un minuto. Attendi prima di riprovare. Se non appare, chiedi assistenza.
    `,
    vtoProGuidanceButton: "Ho Capito!",
    oneGarmentManyModels: "Un Indumento, Molti Modelli",
    oneGarmentManyModelsDesc: "Applica un singolo indumento a una selezione dei tuoi modelli generati.",
    precisePairsDesc: "Crea coppie specifiche di modelli e indumenti uno per uno per un controllo totale.",
    step1Title: "Passo 1: Scegli il Metodo",
    step2Title: "Passo 2: Fornisci gli Input",
    step3Title: "Passo 3: Rivedi e Genera",
    selectModels: "Seleziona Modelli",
    selectedModelsCount: "{count} Modelli Selezionati",
    addPairToQueue: "Aggiungi Coppia alla Coda",
    reviewQueue: "Rivedi Coda ({count})",
    generationQueue: "Coda di Generazione",
    queueEmpty: "La tua coda è vuota. Aggiungi alcune coppie per iniziare.",
    goBack: "Indietro",
    generateNImages: "Genera {count} Immagini",
    filterByPack: "Filtra per Pack",
    allPacks: "Tutti i Pack",
    vtoPacksIntroTitle: "Benvenuto nel Camerino Virtuale per Pack!",
    vtoPacksIntroDescription: "Questo strumento ti permette di generare prove virtuali in batch usando i tuoi modelli pre-generati. Inizia scegliendo come vuoi combinare i tuoi modelli e indumenti.",
    oneToManyInputTitle: "Input per 'Un Indumento, Molti Modelli'",
    oneToManyInputDescription: "Carica l'indumento che vuoi provare e poi seleziona tutti i modelli su cui vuoi vederlo.",
    precisePairsInputTitle: "Input per 'Coppie Precise'",
    precisePairsInputDescription: "Crea la tua coda di generazione aggiungendo coppie specifiche di modello e indumento una per una.",
    randomPairsInputTitle: "Input per 'Coppie Casuali'",
    randomPairsInputDescription: "Carica una selezione di modelli e una selezione di indumenti. Il sistema li abbinerà casualmente.",
    useEntirePack: "Usa Intero Pack",
    provideInputs: "1. Fornisci gli Input",
    createBatch: "Crea Batch",
  },
  en: {
    proMode: "Pro Mode",
    vtoDescription: "A suite of tools for the virtual dressing room. Use 'Single Try-On' for detailed individual creations or 'Batch Process' to generate multiple variations at once.",
    noRecentJobsVTO: "No recent jobs found for this mode.",
    singleVtoDescription: "Upload one person and one garment image. The AI can auto-generate a prompt to combine them, or you can write your own.",
    personImage: "Person Image",
    garmentImage: "Garment Image",
    promptSectionTitle: "2. Prompt",
    promptOptional: "2. Prompt (Optional)",
    autoGenerate: "Auto-Generate",
    promptPlaceholderVTO: "A detailed prompt will appear here...",
    generatingPrompt: "Generating prompt...",
    settingsSectionTitle: "3. Settings",
    startVirtualTryOn: "Start Virtual Try-On",
    resultPlaceholder: "Your result will appear here.",
    batchVtoDescription: "Efficiently create multiple try-on images at once. Choose a batching method below.",
    batchMode: "Batch Mode",
    chooseBatchMethod: "Choose a method for batch processing.",
    oneGarmentDescription: "Apply a single garment to multiple people. Useful for seeing how one item looks on different models.",
    uploadGarment: "Upload Garment",
    uploadPeople: "Upload People",
    selectMultiplePersonImages: "Select multiple person images.",
    randomPairsDescription: "Upload lists of people and garments. The system will randomly pair them up to create diverse combinations.",
    precisePairsDescription: "Create specific model-garment pairs one by one for full control over the output.",
    person: "Person",
    garment: "Garment",
    addPair: "Add Pair",
    startBatchTryOn: "Start Batch Try-On",
    batchQueue: "Batch Queue",
    peopleCount: "People ({count})",
    garmentsCount: "Garments ({count})",
    proSettings: "3. PRO Settings",
    workbenchDescription: "Upload an image in the 'Setup' panel to begin or select a recent job to view the result.",
    uploadToBegin: "Upload an image in the 'Setup' panel to begin",
    orSelectRecent: "or select a recent job to view the result",
    recentProJobs: "Recent Jobs (PRO)",
    noRecentProJobs: "No recent PRO jobs found.",
    denoiseStrength: "Denoise Strength: {denoise}",
    maskExpansion: "Mask Expansion: {maskExpansion}%",
    resetMask: "Reset Mask",
    singleTryOn: "Single Try-On",
    selectedJob: "Selected Job",
    recentJobs: "Recent Jobs",
    oneGarment: "One Garment",
    randomPairs: "Random Pairs",
    precisePairs: "Precise Pairs",
    uploadImages: "1. Upload Images",
    batchProcess: "Batch Process",
    highResolution: "High Resolution",
    numberOfImages: "Number of Images",
    jobFailed: "Job failed: {errorMessage}",
    jobStatus: "Job status: {status}",
    vtoHelpTitle: "Virtual Try-On Guide",
    vtoHelpIntro: "This guide explains the different modes and settings available in the Virtual Try-On tab.",
    vtoHelpSingleTitle: "Single Try-On Mode",
    vtoHelpSingleDesc: "This is the standard mode for generating one try-on image. Upload a person image and a garment image. You can either write a prompt manually or use the 'Auto-Generate' option to have the AI create a detailed prompt for you.",
    vtoHelpBatchTitle: "Batch Process Mode",
    vtoHelpBatchDesc: "This mode is designed for efficiently creating multiple images at once. Choose from three methods:",
    vtoHelpBatchOneGarment: "**One Garment:** Apply a single garment to multiple people. Great for seeing how one item fits on different models.",
    vtoHelpBatchRandom: "**Random Pairs:** Upload a group of people and a group of garments. The system will randomly pair them up.",
    vtoHelpBatchPrecise: "**Precise Pairs:** Create specific person-garment pairs one-by-one for full control.",
    vtoHelpProTitle: "Pro Mode (Inpainting)",
    vtoHelpProDesc: "Pro Mode gives you pixel-level control for complex garment replacements. Instead of replacing the whole outfit, you 'paint' a mask over the area you want to change.",
    vtoHelpProMasking: "**Masking:** Use the brush tool to draw over the area of the source image you want to replace. You can adjust the brush size for precision.",
    vtoHelpProReference: "**Reference Image (Optional):** Provide an image of a garment or texture to apply to the masked area. If none is provided, the AI will fill the area based on the prompt.",
    vtoHelpProSettings: "**Pro Settings:** Control the number of attempts, the 'denoise' strength (how much the AI deviates from the original), and mask expansion for better blending.",
    viewingJob: "You are viewing a completed job. Click 'New' to start another.",
    proSettingsTooltip: "Click to unlock advanced controls for inpainting.",
    promptAppendix: "Prompt Appendix (Optional)",
    promptAppendixPlaceholder: "e.g. wearing light jeans, with hair up",
    promptAppendixPair: "Pair-Specific Instruction",
    promptAppendixPairPlaceholder: "e.g. wearing light jeans",
    garmentMode: "Garment Mode",
    referenceImage: "Reference Image",
    autoMask: "Auto-mask from Reference",
    singleInpaint: "Single Inpaint",
    batchInpaint: "Batch Inpaint",
    vtoProModeDescription: "This PRO mode is specialized for garments. The system will automatically identify and apply the reference garment. For manual masking and general editing, please use the 'Inpainting' page.",
    vtoProGuideTitle: "Virtual Try-On (Pro Mode) Guide",
    vtoProGuideContent: `
### How VTO Pro Mode Works

This mode is a specialized tool designed for high-fidelity **garment replacement**. It uses an advanced AI to automatically identify and swap clothing. Here's what you need to know:

#### 1. Masking is Automatic
This tool **automatically detects the garment** to be replaced based on your reference image. There is no manual brush or masking tool here. For precise, manual control over any part of an image, please use the dedicated **'Inpainting'** page.

#### 2. It's Reference-Driven
The **Reference Image** is the key. The AI analyzes the garment in your reference image (e.g., a t-shirt, a shoe, a handbag) and then finds and replaces the corresponding item on the person in your **Source Image**.
-   A **shoe** reference will replace the shoes.
-   A **shirt** reference will replace the shirt.

#### 3. Ideal for Similar Garments
For best results, use this tool to swap similar types of clothing. For example:
-   Replacing a t-shirt on a model with another t-shirt.
-   Changing the texture or color of an existing jacket.
It is less effective at placing a garment on a person wearing something completely different (e.g., putting a t-shirt on a model wearing a bulky winter coat).

#### 4. One Garment at a Time
This tool processes one garment at a time. If you need to create a full outfit with multiple pieces (e.g., a t-shirt and jeans), you must perform two separate operations:
1.  First, run the process with the person and the t-shirt reference.
2.  Then, use the resulting image as your new source image and run the process again with the jeans reference.

#### 5. Impostazioni PRO Spiegate
- **Numero di Tentativi:** Genera più variazioni della stessa richiesta di inpainting. Utile per ottenere diverse interpretazioni dall'IA.
- **Alta Risoluzione:** Aumenta la risoluzione dell'output. Richiede più tempo ma produce risultati di qualità superiore.
- **Intensità Denoise:** Controlla la libertà creativa dell'IA. Un valore basso (es. 0.5) preserva la struttura originale, ideale per texture changes. Un valore alto (es. 0.9) permette all'IA di essere più creativa, utile per cambiare la forma di un indumento.
- **Espansione Maschera:** Ammorbidisce i bordi della maschera, creando una fusione più naturale tra l'area generata e l'immagine originale. Aumenta questo valore se noti bordi netti nel risultato.
`,
    vtoProGuidanceTitle: "A Quick Tip for Best Results",
    vtoProGuidanceContent: `
Before trying again, please check if your job shows up in the "Recent Jobs" list.

- **If the result is not good**, try turning the "AI Prompt Helper" switch off and try again.
- **If after other 2-3 tries it still does not work**, please stop and ask for assistance.

**Note:** The job may appear in the "Recent Jobs" list after a minute. Please wait before trying again. If it doesn't appear, ask for assistance.
    `,
    vtoProGuidanceButton: "Got It!",
    oneGarmentManyModels: "One Garment, Many Models",
    oneGarmentManyModelsDesc: "Apply a single garment to a selection of your generated models.",
    precisePairsDesc: "Create specific model-garment pairs one by one for full control over the output.",
    step1Title: "Step 1: Choose Your Method",
    step2Title: "Step 2: Provide Your Inputs",
    step3Title: "Step 3: Review & Generate",
    selectModels: "Select Models",
    selectedModelsCount: "{count} Models Selected",
    addPairToQueue: "Add Pair to Queue",
    reviewQueue: "Review Queue ({count})",
    generationQueue: "Generation Queue",
    queueEmpty: "Your queue is empty. Add some pairs to get started.",
    goBack: "Go Back",
    generateNImages: "Generate {count} Images",
    filterByPack: "Filter by Pack",
    allPacks: "All Packs",
    vtoPacksIntroTitle: "Welcome to the Virtual Try-On (Packs)!",
    vtoPacksIntroDescription: "This tool allows you to generate virtual try-ons in bulk using your pre-generated models. Start by choosing how you want to combine your models and garments.",
    oneToManyInputTitle: "Inputs for 'One Garment, Many Models'",
    oneToManyInputDescription: "Upload the one garment you want to try on, then select all the models you want to see wearing it.",
    precisePairsInputTitle: "Inputs for 'Precise Pairs'",
    precisePairsInputDescription: "Build your generation queue by adding specific model and garment pairs one by one.",
    randomPairsInputTitle: "Inputs for 'Random Pairs'",
    randomPairsInputDescription: "Upload a selection of models and a selection of garments. The system will randomly pair them.",
    useEntirePack: "Use Entire Pack",
    provideInputs: "1. Provide Inputs",
    createBatch: "Create Batch",
  },
};