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
              text: `Analyze this watch image and extract the following information:
              - Brand name (e.g., Rolex, Omega, Seiko, etc.)
              - Model name/series (e.g., Submariner, Speedmaster, etc.)
              - Reference number (if visible on dial or case)
              - Watch type (dress, sport, dive, chronograph, etc.)
              - Notable features (complications, materials, etc.)
              - Estimated price range category (budget, mid-range, luxury, ultra-luxury)
              
              Please be as specific as possible. If you cannot determine certain details from the image, indicate "Not visible" for those fields.
              
              Return the information in a structured format.`,
            },
            {
              type: "image",
              image: base64Image,
            },
          ],
        },
      ],
    });

    logger?.info("📝 [WatchImageAnalysis] Analysis completed");
    
    // Parse the response to extract structured data
    const analysisText = result.text;
    
    // Try to extract brand from the response
    const brandMatch = analysisText.match(/brand[:\s]*([^,\n]+)/i);
    const brand = brandMatch ? brandMatch[1].trim() : "Unknown";
    
    // Try to extract model from the response
    const modelMatch = analysisText.match(/model[:\s]*([^,\n]+)/i);
    const model = modelMatch ? modelMatch[1].trim() : "Unknown";
    
    // Try to extract reference number
    const refMatch = analysisText.match(/reference[:\s]*([^,\n]+)/i);
    const referenceNumber = refMatch ? refMatch[1].trim() : "Not visible";

    const extractedData = {
      brand,
      model,
      referenceNumber,
      fullAnalysis: analysisText,
      searchQuery: `${brand} ${model} watch price`.trim(),
    };

    logger?.info("✅ [WatchImageAnalysis] Successfully analyzed watch image", extractedData);
    
    return extractedData;
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
    brand: z.string(),
    model: z.string(),
    referenceNumber: z.string(),
    fullAnalysis: z.string(),
    searchQuery: z.string(),
  }),
  execute: async ({ context: { telegramFileId }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [WatchImageAnalysis] Starting execution with params:", { telegramFileId });
    
    return await analyzeWatchImage({ telegramFileId, logger });
  },
});