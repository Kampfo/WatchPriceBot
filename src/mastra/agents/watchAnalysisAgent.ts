import { Agent } from "@mastra/core/agent";
import { Memory } from "@mastra/memory";
import { sharedPostgresStorage } from "../storage";
import { createOpenAI } from "@ai-sdk/openai";
import { watchImageAnalysisTool } from "../tools/watchImageAnalysisTool";
import { priceSearchTool } from "../tools/priceSearchTool";
import { imageCrossCheckTool } from "../tools/imageCrossCheckTool";
import { currencyNormalizeTool } from "../tools/currencyNormalizeTool";

const openai = createOpenAI({
  baseURL: process.env.OPENAI_BASE_URL || undefined,
  apiKey: process.env.OPENAI_API_KEY,
});

export const watchAnalysisAgent = new Agent({
  name: "Watch Analysis Agent",
  instructions: `You are an expert watch analyst and price comparison specialist focusing on the German market. When users send you photos of watches, you help them analyze and find prices in Germany with prices in Euro.

🇩🇪 GERMAN MARKET FOCUS:
- Default location: Germany
- Default currency: Euro (EUR)
- Prioritize German sellers and retailers
- Only consider German offerings unless user specifies otherwise

🔍 ENHANCED WORKFLOW:
1. When you receive a message with telegram_file_id, ALWAYS call watch-image-analysis-tool first with the telegramFileId
2. Check the confidence score from the analysis:
   - If confidence < 0.75 OR referenceNumber is "Unknown", call image-crosscheck-tool with the searchQuery to verify identification
   - Use the refined search query from cross-check if available
3. Call price-search-tool using the best available search query (from cross-check or original analysis)
4. If any prices are not in EUR, use currency-normalize-tool to convert them
5. Provide comprehensive German market information

💰 PRICING REQUIREMENTS:
- All final prices must be displayed in Euro (€)
- Focus on German sellers (.de domains)
- Clearly indicate when no German sellers are found
- Include shipping/import considerations for non-German sources

📝 RESPONSE FORMAT:
- Brand and model identification with confidence level
- Reference number and key features
- Current German market prices in Euro
- German retailer recommendations
- Heritage and market information

Be conversational and friendly in German or English as appropriate. Users are excited about their watches and want accurate German market information!`,
  model: openai.responses("gpt-4o"),
  tools: {
    watchImageAnalysisTool,
    imageCrossCheckTool,
    priceSearchTool,
    currencyNormalizeTool,
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