import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

const crossCheckWithGoogleImages = async ({
  searchQuery,
  logger,
}: {
  searchQuery: string;
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [ImageCrossCheck] Starting Google Images cross-check", { searchQuery });

  try {
    // Build Google Images search URL with German parameters
    const encodedQuery = encodeURIComponent(searchQuery);
    const googleImagesUrl = `https://www.google.com/search?tbm=isch&hl=de&gl=de&q=${encodedQuery}`;
    
    logger?.info("📝 [ImageCrossCheck] Searching Google Images...", { url: googleImagesUrl });

    // Fetch Google Images results
    const response = await fetch(googleImagesUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(`Google Images request failed: ${response.status}`);
    }

    const html = await response.text();
    
    // Extract image titles and alt texts from the HTML
    const titleMatches = html.match(/"ou":"[^"]*"/g) || [];
    const altMatches = html.match(/alt="[^"]*"/g) || [];
    
    // Combine and clean the extracted text
    const extractedTexts = [
      ...titleMatches.map(match => match.replace(/"ou":"([^"]*)"/, '$1')),
      ...altMatches.map(match => match.replace(/alt="([^"]*)"/, '$1'))
    ].filter(text => text.length > 3); // Filter out very short strings

    logger?.info("📝 [ImageCrossCheck] Extracted image descriptions", { 
      count: extractedTexts.length,
      samples: extractedTexts.slice(0, 3)
    });

    // Analyze the extracted text for watch patterns
    const brandPatterns = ['rolex', 'omega', 'seiko', 'casio', 'tissot', 'tag heuer', 'breitling', 'patek philippe', 'audemars piguet', 'vacheron constantin'];
    const modelPatterns = ['submariner', 'speedmaster', 'datejust', 'daytona', 'seamaster', 'aqua terra', 'monaco', 'carrera'];
    
    const detectedBrands: { [key: string]: number } = {};
    const detectedModels: { [key: string]: number } = {};
    const detectedReferences: string[] = [];

    extractedTexts.forEach(text => {
      const lowerText = text.toLowerCase();
      
      // Count brand mentions
      brandPatterns.forEach(brand => {
        if (lowerText.includes(brand)) {
          detectedBrands[brand] = (detectedBrands[brand] || 0) + 1;
        }
      });
      
      // Count model mentions
      modelPatterns.forEach(model => {
        if (lowerText.includes(model)) {
          detectedModels[model] = (detectedModels[model] || 0) + 1;
        }
      });
      
      // Look for reference numbers (e.g., 126610, 3570.50)
      const refMatches = text.match(/\b\d{4,6}(\.\d{2})?\b/g);
      if (refMatches) {
        detectedReferences.push(...refMatches);
      }
    });

    // Find the most mentioned brand and model
    const topBrand = Object.keys(detectedBrands).reduce((a, b) => 
      detectedBrands[a] > detectedBrands[b] ? a : b, 
      Object.keys(detectedBrands)[0] || ''
    );
    
    const topModel = Object.keys(detectedModels).reduce((a, b) => 
      detectedModels[a] > detectedModels[b] ? a : b,
      Object.keys(detectedModels)[0] || ''
    );

    // Calculate confidence based on how often patterns appear
    const totalTexts = extractedTexts.length;
    const brandMentions = detectedBrands[topBrand] || 0;
    const modelMentions = detectedModels[topModel] || 0;
    
    // Guard against division by zero
    let confidence = 0.1; // Default low confidence
    if (totalTexts > 0) {
      confidence = Math.min(0.95, (brandMentions + modelMentions) / totalTexts);
    } else {
      logger?.warn("⚠️ [ImageCrossCheck] No texts extracted, setting low confidence");
    }

    const result = {
      originalQuery: searchQuery,
      topBrand: topBrand || 'Unknown',
      topModel: topModel || 'Unknown', 
      detectedReferences: [...new Set(detectedReferences)].slice(0, 3), // Unique refs, max 3
      confidence: confidence,
      brandCounts: detectedBrands,
      modelCounts: detectedModels,
      searchUrl: googleImagesUrl,
      refinedSearchQuery: topBrand && topModel ? `${topBrand} ${topModel} watch Preis Deutschland` : searchQuery
    };

    logger?.info("✅ [ImageCrossCheck] Cross-check completed", { 
      topBrand: result.topBrand,
      topModel: result.topModel,
      confidence: result.confidence
    });
    
    return result;
  } catch (error) {
    logger?.error("❌ [ImageCrossCheck] Error during cross-check", { error });
    
    // Return fallback result
    return {
      originalQuery: searchQuery,
      topBrand: 'Unknown',
      topModel: 'Unknown',
      detectedReferences: [],
      confidence: 0.1,
      brandCounts: {},
      modelCounts: {},
      searchUrl: '',
      refinedSearchQuery: searchQuery,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
};

export const imageCrossCheckTool = createTool({
  id: "image-crosscheck-tool",
  description: "Cross-checks watch identification using Google Images search to verify and improve accuracy when initial analysis confidence is low",
  inputSchema: z.object({
    searchQuery: z.string().describe("Search query based on initial watch analysis to verify with Google Images"),
  }),
  outputSchema: z.object({
    originalQuery: z.string().describe("The original search query used"),
    topBrand: z.string().describe("Most frequently mentioned brand in search results"),
    topModel: z.string().describe("Most frequently mentioned model in search results"),
    detectedReferences: z.array(z.string()).describe("Reference numbers found in search results"),
    confidence: z.number().min(0).max(1).describe("Confidence in the cross-check results"),
    brandCounts: z.record(z.number()).describe("Count of brand mentions"),
    modelCounts: z.record(z.number()).describe("Count of model mentions"),
    searchUrl: z.string().describe("Google Images search URL used"),
    refinedSearchQuery: z.string().describe("Improved search query for price lookup"),
  }),
  execute: async ({ context: { searchQuery }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [ImageCrossCheck] Starting execution with params:", { searchQuery });
    
    return await crossCheckWithGoogleImages({ searchQuery, logger });
  },
});