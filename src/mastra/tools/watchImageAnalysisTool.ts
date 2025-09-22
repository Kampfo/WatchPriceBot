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
              text: `Please analyze this watch image and provide detailed information in JSON format.

Analyze the watch for:
1. Brand (e.g., Rolex, Omega, Seiko, etc.)
2. Model/Series name (e.g., Submariner, Speedmaster, etc.)
3. Reference number (if visible on dial, case, or bezel)
4. Watch type (dress, sport, diving, chronograph, etc.)
5. Key features and complications visible
6. Materials (steel, gold, ceramic, etc.)
7. Confidence level (0.0 to 1.0) in your identification
8. Any uncertainties or ambiguities you notice

Return ONLY a valid JSON object with this exact structure:
{
  "brand": "Brand name or 'Unknown'",
  "model": "Model name or 'Unknown'",
  "referenceNumber": "Reference number if visible or 'Unknown'",
  "watchType": "Type category",
  "features": ["feature1", "feature2"],
  "materials": ["material1", "material2"],
  "confidence": 0.85,
  "uncertaintyReasons": ["reason1", "reason2"],
  "candidateQueries": ["search query 1", "search query 2"],
  "searchQuery": "best single search query for this watch"
}

Be conservative with confidence scoring. Use 0.9+ only when you're very certain of brand and model.`,
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
        watchType: "Unknown",
        features: [],
        materials: [],
        confidence: 0.3,
        uncertaintyReasons: ["Failed to parse AI response"],
        candidateQueries: [`${brand} ${model} watch`],
        searchQuery: `${brand} ${model} watch price`
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
    referenceNumber: z.string().describe("Reference number if visible"),
    watchType: z.string().describe("Type of watch (dress, sport, diving, etc.)"),
    features: z.array(z.string()).describe("Key features and complications"),
    materials: z.array(z.string()).describe("Materials used (steel, gold, etc.)"),
    confidence: z.number().min(0).max(1).describe("Confidence in identification (0-1)"),
    uncertaintyReasons: z.array(z.string()).describe("Reasons for any uncertainty"),
    candidateQueries: z.array(z.string()).describe("Alternative search queries"),
    searchQuery: z.string().describe("Best search query for this watch"),
  }),
  execute: async ({ context: { telegramFileId }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [WatchImageAnalysis] Starting execution with params:", { telegramFileId });
    
    return await analyzeWatchImage({ telegramFileId, logger });
  },
});