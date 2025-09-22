import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

const searchGoogleShopping = async ({
  searchQuery,
  logger,
}: {
  searchQuery: string;
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [PriceSearch] Starting Google Shopping search", { searchQuery });

  try {
    // Construct Google Shopping search URL
    const encodedQuery = encodeURIComponent(searchQuery);
    const googleShoppingUrl = `https://www.google.com/search?tbm=shop&q=${encodedQuery}`;
    
    logger?.info("📝 [PriceSearch] Fetching search results...");
    
    // Fetch the Google Shopping page
    const response = await fetch(googleShoppingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    logger?.info("📝 [PriceSearch] Successfully fetched search results");

    // Parse the HTML to extract price information
    const priceResults = parseGoogleShoppingResults(html, logger);
    
    logger?.info("✅ [PriceSearch] Successfully parsed price results", { 
      resultsCount: priceResults.length,
      searchQuery 
    });
    
    return {
      searchQuery,
      googleShoppingUrl,
      results: priceResults,
      summary: generatePriceSummary(priceResults, logger),
    };
  } catch (error) {
    logger?.error("❌ [PriceSearch] Error searching Google Shopping", { error, searchQuery });
    
    // Return a fallback response with manual search suggestion
    return {
      searchQuery,
      googleShoppingUrl: `https://www.google.com/search?tbm=shop&q=${encodeURIComponent(searchQuery)}`,
      results: [],
      summary: `I wasn't able to automatically fetch prices for "${searchQuery}". You can search manually using the Google Shopping link above to find current prices from various retailers.`,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

const parseGoogleShoppingResults = (html: string, logger?: IMastraLogger) => {
  logger?.info("📝 [PriceSearch] Parsing HTML for price data...");
  
  const results: Array<{
    title: string;
    price: string;
    seller: string;
    link?: string;
  }> = [];

  try {
    // Basic regex patterns to extract price information from Google Shopping
    // Note: These patterns may need adjustment as Google changes their HTML structure
    
    // Extract price patterns like $1,234.56 or €999.00
    const pricePattern = /[\$€£¥₹]\s*[\d,]+\.?\d*/g;
    const prices = html.match(pricePattern) || [];
    
    // Extract some basic product information
    const titlePattern = /<h3[^>]*>([^<]+)<\/h3>/g;
    const titles: string[] = [];
    let titleMatch;
    while ((titleMatch = titlePattern.exec(html)) !== null) {
      titles.push(titleMatch[1]);
    }
    
    // Combine first few results
    const maxResults = Math.min(5, Math.min(prices.length, titles.length));
    for (let i = 0; i < maxResults; i++) {
      if (prices[i] && titles[i]) {
        results.push({
          title: titles[i].trim(),
          price: prices[i],
          seller: 'Google Shopping Retailer',
        });
      }
    }
    
    logger?.info("📝 [PriceSearch] Extracted price results", { count: results.length });
  } catch (error) {
    logger?.error("❌ [PriceSearch] Error parsing HTML", { error });
  }

  return results;
};

const generatePriceSummary = (results: Array<{title: string; price: string; seller: string}>, logger?: IMastraLogger) => {
  if (results.length === 0) {
    return "No price information was found. Please try searching manually on Google Shopping or other watch retailer websites.";
  }

  const prices = results
    .map(r => r.price)
    .map(p => parseFloat(p.replace(/[^\d.]/g, '')))
    .filter(p => !isNaN(p))
    .sort((a, b) => a - b);

  if (prices.length === 0) {
    return "Price information was found but couldn't be parsed properly. Please check the Google Shopping link for current prices.";
  }

  const lowest = prices[0];
  const highest = prices[prices.length - 1];
  const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;

  logger?.info("📝 [PriceSearch] Generated price summary", { lowest, highest, average, count: prices.length });

  return `Based on ${results.length} listings found:
• Lowest price: $${lowest.toFixed(2)}
• Highest price: $${highest.toFixed(2)}
• Average price: $${average.toFixed(2)}

Top results:
${results.slice(0, 3).map((r, i) => `${i + 1}. ${r.title} - ${r.price}`).join('\n')}`;
};

export const priceSearchTool = createTool({
  id: "price-search-tool",
  description: "Searches Google Shopping for watch price comparisons and finds the lowest prices",
  inputSchema: z.object({
    searchQuery: z.string().describe("Search query for the watch (e.g., 'Rolex Submariner watch price')"),
  }),
  outputSchema: z.object({
    searchQuery: z.string(),
    googleShoppingUrl: z.string(),
    results: z.array(z.object({
      title: z.string(),
      price: z.string(),
      seller: z.string(),
      link: z.string().optional(),
    })),
    summary: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ context: { searchQuery }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [PriceSearch] Starting execution with params:", { searchQuery });
    
    return await searchGoogleShopping({ searchQuery, logger });
  },
});