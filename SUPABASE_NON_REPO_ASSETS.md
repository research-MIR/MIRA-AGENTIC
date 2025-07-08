# Guida per non addetti ai lavori: Cosa c'è su Supabase (e non nel codice)

Questo documento spiega, in termini semplici, quali parti della nostra applicazione sono gestite da Supabase e perché non si trovano direttamente nel codice sorgente (la "repository" o "repo").

### Cos'è la "Repo" (Repository)?

Pensa alla repository come alla **raccolta di tutti i progetti e i disegni** per costruire un edificio. Contiene il codice che definisce l'aspetto dell'applicazione (i colori, i pulsanti, le pagine) e la logica con cui l'utente interagisce. È il "come" l'applicazione è costruita.

### Cos'è Supabase?

Se la repo è il progetto, **Supabase è l'edificio stesso, già costruito e funzionante, con tutti i suoi servizi interni**. È una piattaforma che ci fornisce tutti gli strumenti di "backend" (il "dietro le quinte") pronti all'uso, senza doverli costruire da zero.

Ecco cosa fornisce Supabase che non troverai nel codice:

#### 1. Il Database (L'Archivio Centrale)

-   **Cosa è:** È un sistema di archiviazione super-organizzato e sicuro dove vengono salvati tutti i dati dell'applicazione.
-   **Analogia:** Pensa a un **enorme archivio blindato**. Nel codice (il progetto dell'edificio) c'è scritto che "esiste un archivio per i documenti dei clienti", ma i documenti veri e propri non sono disegnati nel progetto. Sono fisicamente conservati nell'archivio.
-   **Esempi:** Informazioni degli utenti, cronologia delle chat, dettagli dei prodotti, ecc.

#### 2. Autenticazione (La Sicurezza all'Ingresso)

-   **Cosa è:** È il servizio che gestisce chi può entrare nell'applicazione. Si occupa di registrazioni, login con email e password, e login tramite social (Google, Facebook, ecc.).
-   **Analogia:** È il **team di sicurezza all'ingresso dell'edificio**. Il progetto dell'edificio prevede una porta d'ingresso, ma sono le guardie (Supabase) a controllare i documenti, a dare i badge e a decidere chi può entrare.

#### 3. Storage (Il Magazzino)

-   **Cosa è:** È uno spazio di archiviazione dedicato per i file caricati dagli utenti.
-   **Analogia:** È il **magazzino merci dell'edificio**. Quando un utente carica una foto o un documento, quel file non viene salvato nel codice, ma viene spedito e conservato in modo sicuro nel magazzino di Supabase.

#### 4. Row Level Security (RLS) Policies (Le Regole di Accesso)

-   **Cosa sono:** Queste sono le regole di sicurezza più importanti, applicate direttamente sui dati. Definiscono chi può vedere o modificare cosa.
-   **Analogia:** Sono le **regole associate a ogni badge di accesso**. La tua chiave ti permette di entrare nel tuo ufficio, ma non in quello del tuo capo. Allo stesso modo, una RLS policy dice: "Un utente può vedere solo la propria cronologia chat, ma non quella degli altri". Queste regole sono impostate a livello di "archivio", non nel progetto dell'edificio.

#### 5. Database Functions & Triggers (Gli Automatismi dell'Edificio)

-   **Cosa sono:** Sono piccole operazioni automatiche che avvengono direttamente nell'archivio (il database).
-   **Analogia:**
    -   Un **Trigger** è come un **sensore di movimento**. Esempio: "QUANDO un nuovo utente si registra (il sensore scatta), ALLORA crea automaticamente una riga vuota per il suo profilo".
    -   Una **Function** è un'**operazione pre-programmata** che può essere richiamata. Esempio: "calcola il totale delle vendite di oggi".

#### 6. Cron Jobs (Le Operazioni Pianificate)

-   **Cosa sono:** Sono compiti che vengono eseguiti automaticamente a orari prestabiliti.
-   **Analogia:** Sono le **pulizie notturne o la manutenzione programmata**. Esempio: "OGNI NOTTE a mezzanotte, controlla se ci sono job bloccati e riavviali" oppure "OGNI PRIMO DEL MESE, azzera il contatore di utilizzo degli utenti".

#### 7. Secrets (La Cassaforte)

-   **Cosa sono:** Sono informazioni super-sensibili (come le chiavi per parlare con altri servizi esterni, ad esempio Google o un servizio di pagamento) che non possono assolutamente essere scritte nel codice.
-   **Analogia:** È la **combinazione della cassaforte dell'edificio**. Nessuno la scrive sui muri (il codice), ma viene conservata in un luogo sicuro a cui solo il personale autorizzato (le nostre funzioni serverless) può accedere.

In sintesi, la **repository contiene le istruzioni per costruire l'interfaccia** con cui l'utente interagisce, mentre **Supabase fornisce tutta l'infrastruttura critica e sicura** che fa funzionare l'applicazione dietro le quinte.