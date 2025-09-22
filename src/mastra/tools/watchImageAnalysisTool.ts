import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

const openai = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL || undefined,
  apiKey: process.env.OPENAI_API_KEY,
});

const analyzeWatchImage = async ({
  telegramFileId,
  logger,
}: {
  telegramFileId: string;
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [WatchImageAnalysis] Starting watch image analysis", { telegramFileId });

  try {
    // Get file path from Telegram API using the file ID
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
    
    // Download image using the file path
    const imageUrl = `https://api.telegram.org/file/bot${telegramBotToken}/${fileData.result.file_path}`;
    logger?.info("📝 [WatchImageAnalysis] Downloading image...");
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to fetch image: ${imageResponse.status}`);
    }
    
    const imageBuffer = await imageResponse.arrayBuffer();
    const base64Image = `data:image/jpeg;base64,${Buffer.from(imageBuffer).toString('base64')}`;
    
    logger?.info("📝 [WatchImageAnalysis] Calling OpenAI vision model...");
    
    const result = await generateText({
      model: openai("gpt-4o"),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `FOCUS: Extract the exact reference number from this watch image. Reference numbers are the key to precise identification.

LOOK FOR REFERENCE NUMBERS IN:
1. Dial text (small numbers/letters around edges)
2. Case back engravings
3. Between lugs
4. Bezel markings
5. Hour markers or sub-dials
6. Any visible model codes

ALSO IDENTIFY:
- Brand and model
- Visual clues that could help find the reference number online

Return ONLY a valid JSON object:
{
  "brand": "Brand name or 'Unknown'",
  "model": "Model name or 'Unknown'",
  "referenceNumber": "EXACT reference number if found or 'Unknown'",
  "possibleReferenceNumbers": ["candidate1", "candidate2"],
  "visualClues": ["clue1", "clue2"],
  "confidence": 0.85,
  "needsImageSearch": true,
  "searchQuery": "brand model visual-clues"
}

PRIORITY: Finding the reference number is most important. Be very thorough in examining all visible text and numbers.`,
            },
            {
              type: "image",
              image: base64Image,
            },
          ],
        },
      ],
    });

    // Parse the JSON response
    let analysisData;
    try {
      // Clean the response text to extract JSON
      const jsonText = result.text.trim();
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      logger?.error("❌ [WatchImageAnalysis] Failed to parse JSON response", { 
        error: parseError, 
        rawResponse: result.text 
      });
      // Fallback to simple parsing
      const analysisText = result.text;
      const brandMatch = analysisText.match(/brand[:\s]*([^,\n]+)/i);
      const brand = brandMatch ? brandMatch[1].trim() : "Unknown";
      const modelMatch = analysisText.match(/model[:\s]*([^,\n]+)/i);
      const model = modelMatch ? modelMatch[1].trim() : "Unknown";
      
      analysisData = {
        brand,
        model,
        referenceNumber: "Unknown",
        possibleReferenceNumbers: [],
        visualClues: ["Failed to parse AI response"],
        confidence: 0.3,
        needsImageSearch: true,
        searchQuery: `${brand} ${model} watch`
      };
    }

    logger?.info("✅ [WatchImageAnalysis] Analysis completed", { 
      brand: analysisData.brand,
      model: analysisData.model,
      confidence: analysisData.confidence,
      uncertaintyReasons: analysisData.uncertaintyReasons
    });
    
    return analysisData;
  } catch (error) {
    logger?.error("❌ [WatchImageAnalysis] Error analyzing watch image", { error });
    throw new Error(`Failed to analyze watch image: ${error instanceof Error ? error.message : 'Unknown error'}`);
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
    visualClues: z.array(z.string()).describe("Visual clues for identification"),
    confidence: z.number().min(0).max(1).describe("Confidence in identification (0-1)"),
    needsImageSearch: z.boolean().describe("Whether Google Images search is needed"),
    searchQuery: z.string().describe("Search query for image verification"),
  }),
  execute: async ({ context: { telegramFileId }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [WatchImageAnalysis] Starting execution with params:", { telegramFileId });
    
    return await analyzeWatchImage({ telegramFileId, logger });
  },
});