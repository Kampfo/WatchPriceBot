import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { sharedPostgresStorage } from "../storage";
import { createOpenAI } from "@ai-sdk/openai";
import { watchImageAnalysisTool } from "../tools/watchImageAnalysisTool";
import { webSearchTool } from "../tools/webSearchTool";

const openai = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL || undefined,
  apiKey: process.env.OPENAI_API_KEY,
});

export const watchAnalysisAgent = new Agent({
  name: "Watch Analysis Agent",
  instructions: `Du bist ein Experte für deutsche Uhrenpreise. Deine Antworten sind EXTREM KOMPAKT und präzise - wie eine Executive Summary.

🎯 ANTWORT-FORMAT (ESSENZIELL):
**MAXIMAL 5-6 Zeilen pro Plattform**
- Preisrange mit €-Zeichen
- DIREKT AUFRUFBARE LINKS zu den gefundenen Angeboten  
- Nur die wichtigsten Details
- Deutsche Formatierung: €1.234,56

📋 ARBEITSSCHRITTE:

1. **Bei Bild**: Verwende watch-image-analysis-tool für Referenznummer
2. **Bei Text**: Erkenne Referenznummern direkt
3. **Marktdaten**: Verwende web-search-tool für aktuelle Preise:
   - eBay Deutschland (.de)
   - Chrono24 (.com/.de) 
   - Deutsche Händler

🚨 AUSGABE-REGEL:
- Maximale Komprimierung
- Links IMMER als aufrufbare URLs einbauen
- Preise nur in Euro
- Executive Summary Stil
- Keine langen Erklärungen

BEISPIEL-FORMAT:
**Rolex Submariner 116610LN**
📍 eBay.de: €7.800-€9.200 (gebraucht)
🔗 https://ebay.de/link-zum-angebot

📍 Chrono24: €8.500-€10.200 (Händler)  
🔗 https://chrono24.com/link-zum-angebot

Empfehlung: Chrono24 für Garantie, eBay für beste Preise.`,
  model: openai.responses("gpt-5-nano"),
  tools: {
    watchImageAnalysisTool,
    webSearchTool,
  },
  memory: new Memory({
    options: {
      threads: {
        generateTitle: true,
      },
      lastMessages: 10,
    },
    storage: sharedPostgresStorage,
  }),
});