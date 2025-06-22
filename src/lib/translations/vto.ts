export const vtoTranslations = {
  it: {
    proMode: "Modalità Pro",
    vtoDescription: "Una suite di strumenti per il camerino virtuale. Usa 'Prova Singola' per creazioni individuali dettagliate o 'Processo Multiplo' per generare più variazioni contemporaneamente.",
    noRecentJobsVTO: "Nessun job recente trovato per questa modalità.",
    singleVtoDescription: "Carica un'immagine di una persona e una di un indumento. L'IA può generare automaticamente un prompt per combinarli, oppure puoi scriverne uno tu.",
    personImage: "Immagine Persona",
    garmentImage: "Immagine Indumento",
    promptSectionTitle: "2. Prompt",
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
    uploadGarments: "Carica Indumenti",
    selectMultipleGarmentImages: "Seleziona più immagini di indumenti.",
    precisePairsDescription: "Crea coppie specifiche persona-indumento una per una per un controllo totale sull'output.",
    person: "Persona",
    garment: "Indumento",
    addPair: "Aggiungi Coppia",
    startBatchTryOn: "Avvia Prova Multipla",
    batchQueue: "Coda di Lavorazione",
    peopleCount: "Persone ({count})",
    garmentsCount: "Indumenti ({count})",
    proModeDescription: "Una suite di strumenti per il camerino virtuale. Usa 'Prova Singola' per creazioni individuali dettagliate o 'Processo Multiplo' per generare più variazioni contemporaneamente.",
    inputs: "1. Input",
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
    precisePairs: "Coppie Precise",
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
    inpaintingGuide: "Guida all'Inpainting",
    inpaintingGuideTitle: "Guida all'Inpainting Avanzato",
    inpaintingGuideContent: `
### Strategie per Risultati Migliori

L'inpainting è uno strumento potente per sostituire parti di un'immagine, ma richiede un approccio specifico per ottenere i migliori risultati.

#### 1. La Maschera è Tutto
- **Sii generoso:** È meglio mascherare un'area leggermente più grande del necessario piuttosto che troppo piccola. Questo aiuta l'IA ad avere più spazio per fondere il nuovo contenuto.
- **Usa l'Espansione:** L'impostazione "Espansione Maschera" è la tua migliore amica. Aumentala per ammorbidire i bordi e ottenere una transizione più naturale tra l'originale e il generato.

#### 2. Il Prompt Preciso
- **Descrivi solo la sostituzione:** Il tuo prompt dovrebbe descrivere solo ciò che vuoi che appaia *all'interno* dell'area mascherata. Non descrivere l'intera immagine.
- **Sii dettagliato:** Includi dettagli su materiale, texture, stile e illuminazione.
  - **❌ Esempio negativo:** "una maglietta blu"
  - **✅ Esempio positivo:** "una maglietta blu in cotone fotorealistica con pieghe morbide, sotto una luce da studio diffusa"

#### 3. Il Riferimento Stilistico (Opzionale)
- **È per lo stile, non per la forma:** L'immagine di riferimento guida lo stile (colori, texture, illuminazione), non la forma esatta dell'oggetto.
- **Esempio:** Se fornisci l'immagine di una giacca di pelle, l'IA cercherà di creare una *nuova texture* di pelle nell'area mascherata, non di copiare esattamente quella giacca.

#### 4. Denoise e Creatività
- **Controlla la libertà dell'IA:** L'impostazione "Intensità Denoise" determina quanto l'IA può deviare dall'immagine originale all'interno della maschera.
  - **Basso Denoise (es. 0.5-0.7):** Ideale per cambiamenti sottili come colore o texture, mantenendo la forma originale dell'indumento.
  - **Alto Denoise (es. 0.8-1.0):** Concede all'IA più libertà creativa. Usalo se vuoi cambiare la forma dell'indumento (es. trasformare una t-shirt in una giacca).
`
  },
  en: {
    proMode: "Pro Mode",
    vtoDescription: "A suite of tools for the virtual dressing room. Use 'Single Try-On' for detailed individual creations or 'Batch Process' to generate multiple variations at once.",
    noRecentJobsVTO: "No recent jobs found for this mode.",
    singleVtoDescription: "Upload one person and one garment image. The AI can auto-generate a prompt to combine them, or you can write your own.",
    personImage: "Person Image",
    garmentImage: "Garment Image",
    promptSectionTitle: "2. Prompt",
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
    uploadGarments: "Upload Garments",
    selectMultipleGarmentImages: "Select multiple garment images.",
    precisePairsDescription: "Create specific person-garment pairs one by one for full control over the output.",
    person: "Person",
    garment: "Garment",
    addPair: "Add Pair",
    startBatchTryOn: "Start Batch Try-On",
    batchQueue: "Batch Queue",
    peopleCount: "People ({count})",
    garmentsCount: "Garments ({count})",
    proModeDescription: "A suite of tools for the virtual dressing room. Use 'Single Try-On' for detailed individual creations or 'Batch Process' to generate multiple variations at once.",
    inputs: "1. Inputs",
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
    inpaintingGuide: "Inpainting Guide",
    inpaintingGuideTitle: "Advanced Inpainting Guide",
    inpaintingGuideContent: `
### Strategies for Better Results

Inpainting is a powerful tool for replacing parts of an image, but it requires a specific approach to get the best results.

#### 1. The Mask is Everything
- **Be generous:** It's better to mask a slightly larger area than necessary rather than too small. This helps the AI have more room to blend the new content.
- **Use Expansion:** The "Mask Expansion" setting is your best friend. Increase it to soften the edges and achieve a more natural transition between the original and the generated content.

#### 2. The Precise Prompt
- **Describe only the replacement:** Your prompt should only describe what you want to appear *inside* the masked area. Do not describe the entire image.
- **Be detailed:** Include details about material, texture, style, and lighting.
  - **❌ Bad example:** "a blue shirt"
  - **✅ Good example:** "a photorealistic blue cotton t-shirt with soft wrinkles, under diffused studio lighting"

#### 3. The Style Reference (Optional)
- **It's for style, not shape:** The reference image guides the style (colors, textures, lighting), not the exact shape of the object.
- **Example:** If you provide an image of a leather jacket, the AI will try to create a *new* leather texture in the masked area, not copy that exact jacket.

#### 4. Denoise and Creativity
- **Control the AI's freedom:** The "Denoise Strength" setting determines how much the AI can deviate from the original image within the mask.
  - **Low Denoise (e.g., 0.5-0.7):** Ideal for subtle changes like color or texture, while keeping the original shape of the garment.
  - **High Denoise (e.g., 0.8-1.0):** Gives the AI more creative freedom. Use this if you want to change the shape of the garment (e.g., turning a t-shirt into a jacket).
`
  },
};