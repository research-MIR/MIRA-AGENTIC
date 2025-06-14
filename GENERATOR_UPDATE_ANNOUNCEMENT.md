@Samuele Bandera @Simone Grossi

Ciao a tutti,
Ho aggiornato il generatore di immagini con le seguenti funzionalità:
1. Riferimenti Multi-Indumento: Ora è possibile caricare più immagini nella sezione "Riferimento Indumento" per comporre un outfit completo (es. una foto per la giacca, una per i pantaloni).

2. Riferimento Stilistico: È stato aggiunto uno slot separato per il "Riferimento Stile". Questa immagine viene usata per definire l'estetica della scena (illuminazione, colori, posa) e non l'abbigliamento.

3. Controllo Specifico tramite Prompt: Il prompt di testo può specificare quali elementi prendere dalle immagini di riferimento.


Funzionamento e Prompt Finali
Qui di seguito, come l'AI si comporta in base al livello di dettaglio del prompt utente.

Caso 1: Funzionamento Automatico (Prompt Semplice)
Se si caricano le reference ma si inserisce un prompt generico, l'AI combinerà tutti gli elementi in modo intelligente.

Prompt Utente:
"Una modella in un contesto urbano."
Reference Caricate:
Indumento 1: Giacca di pelle nera.
Indumento 2: Jeans strappati.
Stile: Foto di una strada di Tokyo di notte con luci al neon e una persona appoggiata al muro.
Prompt Finale Generato dall'AI (Esempio):
"Un ritratto fotorealistico di una modella appoggiata a un muro, che indossa una giacca di pelle nera e jeans blu strappati, su una strada cittadina di notte, illuminata da vibranti luci al neon, con uno stile cinematografico e un'atmosfera suggestiva."


Caso 2: Funzionamento Guidato (Prompt Specifico)
Se si danno istruzioni precise, l'AI ignorerà gli elementi non richiesti delle reference per seguire i comandi.

Prompt Utente:
"Una modella in una foresta, l'illuminazione della reference di stile."
Reference Caricate:
(Le stesse di prima)
Prompt Finale Generato dall'AI (Esempio):
"Un ritratto fotorealistico di una modella in una foresta oscura, che indossa una giacca di pelle nera e jeans blu strappati. L'illuminazione è drammatica e colorata, simile a quella delle luci al neon, ma adattata a un contesto naturale per creare contrasto."

Questo aggiornamento permette sia di lasciare fare all'AI per risultati rapidi, sia di dirigerla con precisione per esigenze specifiche.
Lascio allegato un file di testo per i designer che spiega più al dettaglio l'uso e le possibilità di linguaggio naturale.

Buon lavoro.