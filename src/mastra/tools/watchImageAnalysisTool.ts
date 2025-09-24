import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const openai = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL || undefined,
  apiKey: process.env.OPENAI_API_KEY,
});

type ParsedImageAnalysis = {
  brand: string;
  model: string;
  referenceNumber: string;
  possibleReferenceNumbers: string[];
  detectedTexts: string[];
  visualClues: string[];
  confidence: number;
  needsImageSearch: boolean;
  searchQuery: string;
  notes: string[];
};

const normaliseStringArray = (values: unknown, fallback: string[] = []): string[] => {
  if (!Array.isArray(values)) {
    return fallback;
  }
  const cleaned = values
    .map(value => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean);
  const unique = Array.from(new Set(cleaned));
  return unique.length > 0 ? unique : fallback;
};

const sanitiseAnalysis = (raw: Partial<ParsedImageAnalysis>): ParsedImageAnalysis => {
  const brand = (raw.brand ?? "Unknown").trim() || "Unknown";
  const model = (raw.model ?? "Unknown").trim() || "Unknown";
  const possibleReferenceNumbers = normaliseStringArray(raw.possibleReferenceNumbers);
  const detectedTexts = normaliseStringArray(raw.detectedTexts, possibleReferenceNumbers);
  const visualClues = normaliseStringArray(raw.visualClues);
  const notes = normaliseStringArray(raw.notes);

  const referenceNumberCandidate = (raw.referenceNumber ?? "Unknown").trim();
  const referenceNumber = referenceNumberCandidate || "Unknown";

  const confidence = typeof raw.confidence === "number" ? Math.max(0, Math.min(1, raw.confidence)) : 0.4;
  const needsImageSearch =
    typeof raw.needsImageSearch === "boolean"
      ? raw.needsImageSearch
      : referenceNumber === "Unknown" || confidence < 0.65;

  const searchQuery = raw.searchQuery
    ? raw.searchQuery
    : referenceNumber !== "Unknown"
      ? `${brand} ${referenceNumber}`.trim()
      : `${brand} ${model}`.trim();

  return {
    brand,
    model,
    referenceNumber,
    possibleReferenceNumbers,
    detectedTexts,
    visualClues,
    confidence,
    needsImageSearch,
    searchQuery: searchQuery || `${brand} watch`,
    notes,
  };
};

const analyzeWatchImage = async ({
  telegramFileId,
  logger,
}: {
  telegramFileId: string;
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [WatchImageAnalysis] Starting watch image analysis", { telegramFileId });

  try {
    logger?.info("📝 [WatchImageAnalysis] Getting file path from Telegram...");
    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!telegramBotToken) {
      throw new Error("TELEGRAM_BOT_TOKEN not found");
    }

    const fileResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/getFile?file_id=${telegramFileId}`);
    const fileData = await fileResponse.json();

    if (!fileData.ok) {
      throw new Error(`Failed to get file path: ${fileData.description}`);
    }

    const imageUrl = `https://api.telegram.org/file/bot${telegramBotToken}/${fileData.result.file_path}`;
    logger?.info("📝 [WatchImageAnalysis] Downloading image...");
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = `data:image/jpeg;base64,${Buffer.from(imageBuffer).toString("base64")}`;

    logger?.info("📝 [WatchImageAnalysis] Calling OpenAI vision model...");

    const result = await generateText({
      model: openai("gpt-4o"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Du bist ein Profi für das Erkennen von Uhren-Referenzen auf Fotos.
Analysiere das Bild gründlich und gib ausschließlich valides JSON zurück.

Pflichtfelder:
{
  "brand": "Marke (z. B. Rolex)",
  "model": "Modell/Serie",
  "referenceNumber": "Exakte Referenznummer oder 'Unknown'",
  "possibleReferenceNumbers": ["alle sichtbaren Kandidaten"],
  "detectedTexts": ["alle lesbaren Beschriftungen, Gravuren und Zahlen"],
  "visualClues": ["Material, Farbe, Komplikationen, Lünetten-Typ etc."],
  "confidence": 0.0-1.0,
  "needsImageSearch": true/false (true, wenn Referenz unsicher oder nicht sichtbar),
  "searchQuery": "Bevorzugt 'Marke Referenz', sonst 'Marke Modell'",
  "notes": ["wichtige Beobachtungen"]
}

Vorgehen:
1. Liste zuerst jedes lesbare Wort/Zahl in detectedTexts (z. B. 'OYSTER PERPETUAL', '116610LN').
2. Ermittle daraus mögliche Referenzen und lege sie in possibleReferenceNumbers ab (inkl. Bruchstücke).
3. Falls eine Referenz eindeutig ist, trage sie in referenceNumber ein.
4. Confidence hoch nur bei klarer Referenz (z. B. sichtbare Gravur).
5. needsImageSearch = true, wenn Referenz unsicher bleibt oder mehrere Kandidaten existieren.
6. Gib NUR das JSON zurück, ohne zusätzliche Erklärungen.`,
            },
            {
              type: "image",
              image: base64Image,
            },
          ],
        },
      ],
    });

    let analysisData: ParsedImageAnalysis;
    try {
      const jsonText = result.text.trim();
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        analysisData = sanitiseAnalysis(parsed);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      logger?.error("❌ [WatchImageAnalysis] Failed to parse JSON response", {
        error: parseError,
        rawResponse: result.text,
      });
      const fallbackData: ParsedImageAnalysis = {
        brand: "Unknown",
        model: "Unknown",
        referenceNumber: "Unknown",
        possibleReferenceNumbers: [],
        detectedTexts: [],
        visualClues: ["Failed to parse AI response"],
        confidence: 0.2,
        needsImageSearch: true,
        searchQuery: "luxury watch", // generic fallback
        notes: ["Vision-Modell lieferte kein valides JSON"],
      };
      analysisData = fallbackData;
    }

    logger?.info("✅ [WatchImageAnalysis] Analysis completed", {
      brand: analysisData.brand,
      model: analysisData.model,
      referenceNumber: analysisData.referenceNumber,
      confidence: analysisData.confidence,
      needsImageSearch: analysisData.needsImageSearch,
    });

    return analysisData;
  } catch (error) {
    logger?.error("❌ [WatchImageAnalysis] Error analyzing watch image", { error });
    throw new Error(`Failed to analyze watch image: ${error instanceof Error ? error.message : "Unknown error"}`);
  }
};

export const watchImageAnalysisTool = createTool({
  id: "watch-image-analysis-tool",
  description: "Analyzes watch images to identify brand, model, reference number and other details using AI vision. Use this when a user sends a photo of a watch.",
  inputSchema: z.object({
    telegramFileId: z.string().describe("Telegram file ID of the watch image to analyze"),
  }),
  outputSchema: z.object({
    brand: z.string().describe("Watch brand name"),
    model: z.string().describe("Watch model/series name"),
    referenceNumber: z.string().describe("Exact reference number if found"),
    possibleReferenceNumbers: z.array(z.string()).describe("Candidate reference numbers"),
    detectedTexts: z.array(z.string()).describe("All detected textual elements"),
    visualClues: z.array(z.string()).describe("Visual clues for identification"),
    confidence: z.number().min(0).max(1).describe("Confidence in identification (0-1)"),
    needsImageSearch: z.boolean().describe("Whether Google Images search is needed"),
    searchQuery: z.string().describe("Search query for image verification"),
    notes: z.array(z.string()).describe("Additional observations from the model"),
  }),
  execute: async ({ context: { telegramFileId }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [WatchImageAnalysis] Starting execution with params:", { telegramFileId });

    const result = await analyzeWatchImage({ telegramFileId, logger });
    return result;
  },
});
