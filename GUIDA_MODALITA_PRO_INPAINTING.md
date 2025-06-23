# Guida alla Modalità PRO: Inpainting e Correzione Avanzata

Benvenuto nello strumento più potente del tuo arsenale creativo. La **Modalità Pro** trasforma la funzione di Prova Virtuale da un semplice strumento per cambiare abiti in un motore chirurgico di inpainting e correzione, dandoti un controllo a livello di pixel sulle tue immagini.

Questa guida si concentra esclusivamente sull'utilizzo della Modalità Pro per l'editing di immagini generico, come cambiare acconciature, aggiungere texture, rimuovere oggetti o alterare dettagli specifici.

---

### Come Iniziare: Accedere alla Modalità Pro

1.  Vai alla pagina **Prova Virtuale** dalla barra laterale principale.
2.  Nell'angolo in alto a destra, trova l'interruttore con l'etichetta **"Modalità Pro"** e attivalo. L'interfaccia cambierà, mostrandoti l'area di lavoro della Modalità Pro.

---

### Il Flusso di Lavoro in Modalità Pro: Guida Passo-Passo

Il processo è progettato per essere intuitivo. Segui questi passaggi per effettuare modifiche precise alle tue immagini.

#### Passo 1: Carica la Tua Immagine Sorgente

Questa è la tua tela. È l'immagine che vuoi modificare.

-   **Come fare:** Puoi trascinare e rilasciare un'immagine nella grande area centrale oppure cliccare per aprire il selettore di file.
-   **Risultato:** La tua immagine apparirà nell'area di lavoro principale, pronta per essere modificata.

#### Passo 2: Mascheratura - Indica all'IA *Dove* Lavorare

Questo è il passaggio interattivo più importante. Dovrai "dipingere" una maschera sull'area dell'immagine che vuoi che l'IA modifichi. Tutto ciò che si trova al di fuori della maschera rimarrà intatto.

-   **Come fare:**
    1.  Il tuo cursore diventerà un pennello. Clicca e trascina sulle parti dell'immagine che vuoi sostituire o modificare.
    2.  Usa i **Controlli Maschera** in basso sull'immagine per regolare la dimensione del pennello, sia per dettagli fini che per aree più ampie.
    3.  Se commetti un errore, clicca sul pulsante "Resetta Maschera" per ricominciare da capo.

#### Passo 3: Fornire Istruzioni - Indica all'IA *Cosa* Fare

Una volta mascherata un'area, devi dire all'IA cosa metterci. Hai due modi potenti per farlo.

##### **Caso d'Uso A: Inpainting con un Prompt Testuale**

Usa questa opzione quando vuoi generare qualcosa di nuovo partendo da una descrizione.

-   **Come fare:**
    1.  Nella sezione **"2. Prompt"**, assicurati che l'interruttore **"Auto-Genera"** sia **SPENTO**.
    2.  Nella casella di testo, descrivi **solo ciò che dovrebbe apparire all'interno dell'area mascherata**.
-   **CONSIGLIO CRITICO:** Non descrivere l'intera scena. Descrivi solo l'oggetto o la modifica che vuoi apportare, come se esistesse già nell'illuminazione e nel contesto dell'immagine originale.
    -   **❌ Esempio negativo:** "una donna con lunghi capelli biondi e fluenti." (Descrive l'intero soggetto).
    -   **✅ Esempio positivo:** "capelli biondi lunghi, fluenti e fotorealistici con riflessi naturali, che riflettono la luce ambientale della scena." (Descrive solo l'elemento da inserire).

##### **Caso d'Uso B: Inpainting con un'Immagine di Riferimento**

Usa questa opzione quando vuoi trasferire un oggetto, una texture o uno stile specifico da un'altra immagine.

-   **Come fare:**
    1.  Nella sezione **"1. Input"**, carica un'immagine nel box **"Immagine di Riferimento"**. Potrebbe essere una foto di una texture specifica (come metallo o legno), un'acconciatura diversa o un oggetto che vuoi inserire.
    2.  Nella sezione **"2. Prompt"**, è altamente consigliato lasciare l'opzione **"Auto-Genera" ACCESA**. L'IA analizzerà sia la tua immagine sorgente che quella di riferimento per creare il prompt tecnico perfetto per fonderle insieme.
    3.  (Opzionale) Se vuoi guidare ulteriormente l'IA, puoi aggiungere un'istruzione specifica nella casella "Appendice Prompt" sotto le Impostazioni PRO.

#### Passo 4: Perfeziona con le Impostazioni PRO

La sezione a tendina **"3. Impostazioni PRO"** ti dà un controllo avanzato sulla generazione.

-   **Numero di Immagini:** Genera più variazioni contemporaneamente per vedere diverse interpretazioni dall'IA.
-   **Alta Risoluzione:** Crea un'immagine finale più grande e dettagliata.
-   **Intensità Denoise:** Questo è il tuo cursore della "creatività".
    -   Un **valore basso** (es. 0.5) si atterrà strettamente alle forme e all'illuminazione dell'immagine originale all'interno della maschera. Ideale per cambiare colori o texture.
    -   Un **valore alto** (es. 0.9) dà all'IA più libertà di cambiare la forma e la struttura dell'oggetto all'interno della maschera.
-   **Espansione Maschera:** Questo è un potente strumento di fusione. Espande e ammorbidisce leggermente il bordo della tua maschera, aiutando a creare una transizione molto più fluida e naturale tra l'immagine originale e il contenuto appena generato. Aumenta questo valore se noti bordi netti nei tuoi risultati.

**Nota:** Passa il mouse sopra ogni impostazione nella pagina per visualizzare un **tooltip** con una spiegazione dettagliata di cosa fa.

#### Passo 5: Genera!

Clicca sul pulsante **"Genera"**. Il tuo lavoro verrà inviato alla coda e potrai monitorarne l'avanzamento nel tracker "Job Attivi" nella barra laterale. Il risultato apparirà nel pannello "Risultato" quando sarà pronto.

---

### Consigli e Best Practice

-   **Maschera Generosamente:** Spesso è meglio mascherare un'area leggermente più grande di quanto pensi sia necessario. Questo dà all'IA più spazio per fondere la sua creazione con l'immagine originale.
-   **Inizia con un Denoise Alto:** Per cambiamenti significativi (come aggiungere un cappello), inizia con un valore di Denoise alto (0.85-1.0). Per modifiche sottili (come cambiare il colore di un tessuto), inizia con un valore più basso (0.5-0.7).
-   **Itera:** Il tuo primo risultato potrebbe non essere perfetto. Usalo come un'esperienza di apprendimento. Modifica la maschera, il prompt o l'intensità del Denoise e riprova.
-   **Usa l'elenco "Job Recenti":** I tuoi lavori completati appaiono nell'elenco in basso. Puoi cliccarci sopra per rivedere i risultati e le impostazioni che sono state utilizzate.