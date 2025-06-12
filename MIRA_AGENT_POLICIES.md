# Mira Agent: Policy di Sicurezza di Supabase (Vista Tecnica)

Questo documento delinea le policy di Row Level Security (RLS) applicate alle tabelle relative all'applicazione Mira Agent. Queste policy sono cruciali per garantire la privacy e la sicurezza dei dati, specificando chi può accedere o modificare i dati in determinate condizioni. Ogni policy include la sua descrizione in linguaggio semplice e la definizione SQL sottostante.

---

## Policy Principali del Mira Agent

Queste policy governano i componenti centrali del sistema Mira Agent.

### Tabella `mira-agent-jobs`
Questa tabella memorizza lo stato e la cronologia di ogni attività eseguita dall'agente.

#### **Permetti agli utenti autenticati di leggere i job**
- **Descrizione:** Qualsiasi utente autenticato può leggere i dati dei job. Questo è necessario affinché il frontend possa ricevere aggiornamenti in tempo reale sullo stato di avanzamento dei job.
- **Definizione SQL:**
  ```sql
  USING (true)
  ```

#### **Permetti accesso completo al service_role**
- **Descrizione:** I servizi interni (Edge Functions) hanno accesso illimitato per creare, leggere, aggiornare ed eliminare i job.
- **Definizione SQL:**
  ```sql
  USING (auth.role() = 'service_role')
  ```

### Tabella `mira-agent-config`
Questa tabella memorizza le impostazioni di configurazione per l'agente.

#### **Permetti agli utenti autenticati di leggere la configurazione**
- **Descrizione:** Gli utenti autenticati possono leggere le impostazioni di configurazione, ma non possono modificarle.
- **Definizione SQL:**
  ```sql
  USING (auth.role() = 'authenticated'::text)
  ```

#### **Permetti accesso completo alla configurazione per il service_role**
- **Descrizione:** Solo i servizi interni possono gestire le impostazioni di configurazione dell'agente.
- **Definizione SQL:**
  ```sql
  USING (auth.role() = 'service_role'::text)
  ```

### Tabella `mira-agent-models`
Questa tabella elenca i modelli di IA disponibili per la generazione.

#### **Permetti agli utenti autenticati di leggere i modelli**
- **Descrizione:** Qualsiasi utente autenticato può visualizzare l'elenco dei modelli di IA disponibili.
- **Definizione SQL:**
  ```sql
  USING (auth.role() = 'authenticated'::text)
  ```

#### **Permetti accesso completo ai modelli per il service_role**
- **Descrizione:** Solo i servizi interni possono aggiungere o modificare i modelli di IA disponibili.
- **Definizione SQL:**
  ```sql
  USING (auth.role() = 'service_role'::text)
  ```

### Bucket di Storage (`storage.objects`)

#### **Bucket `mira-agent-user-uploads`**
- **Descrizione:** Gli utenti autenticati possono caricare file. Solo i servizi interni (come l'agente) possono leggere questi file dopo che sono stati caricati.
- **Definizione SQL:**
  ```sql
  -- Per operazioni di INSERT
  CREATE POLICY "Authenticated users can upload files" 
  ON storage.objects FOR INSERT 
  WITH CHECK (bucket_id = 'mira-agent-user-uploads');

  -- Per operazioni di SELECT
  CREATE POLICY "Service role can access all user uploads" 
  ON storage.objects FOR SELECT 
  USING (bucket_id = 'mira-agent-user-uploads' AND auth.role() = 'service_role');
  ```

#### **Bucket `mira-generations`**
- **Descrizione:** Questo bucket è altamente protetto. Gli utenti possono solo visualizzare, caricare o eliminare file dalla loro cartella dedicata all'interno del bucket, garantendo che possano accedere solo alle immagini che hanno generato. I servizi interni hanno accesso completo.
- **Definizione SQL:**
  ```sql
  -- Per operazioni di SELECT
  CREATE POLICY "Authenticated users can view their own images"
  ON storage.objects FOR SELECT
  USING ( bucket_id = 'mira-generations' AND (storage.foldername(name))[1] = auth.uid()::text );

  -- Per operazioni di INSERT
  CREATE POLICY "Authenticated users can upload to their own folder"
  ON storage.objects FOR INSERT
  WITH CHECK ( bucket_id = 'mira-generations' AND (storage.foldername(name))[1] = auth.uid()::text );

  -- Per operazioni di DELETE
  CREATE POLICY "Authenticated users can delete their own images"
  ON storage.objects FOR DELETE
  USING ( bucket_id = 'mira-generations' AND (storage.foldername(name))[1] = auth.uid()::text );

  -- Per TUTTE le operazioni da parte del backend
  CREATE POLICY "Service role has full access"
  ON storage.objects FOR ALL
  USING ( auth.role() = 'service_role' );
  ```