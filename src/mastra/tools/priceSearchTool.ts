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
    // Construct German Google Shopping search URL with German keywords
    const germanQuery = `${searchQuery} Preis Deutschland kaufen`;
    const encodedQuery = encodeURIComponent(germanQuery);
    const googleShoppingUrl = `https://www.google.com/search?tbm=shop&hl=de&gl=de&lr=lang_de&q=${encodedQuery}`;
    
    logger?.info("📝 [PriceSearch] Fetching search results...");
    
    // Fetch the Google Shopping page
    const response = await fetch(googleShoppingUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
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
      googleShoppingUrl: `https://www.google.com/search?tbm=shop&hl=de&gl=de&lr=lang_de&q=${encodeURIComponent(searchQuery + ' Preis Deutschland')}`,
      results: [],
      summary: `Ich konnte keine Preise für "${searchQuery}" automatisch abrufen. Sie können manuell über den Google Shopping Link oben nach aktuellen Preisen verschiedener Händler suchen.`,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
};

const parseGoogleShoppingResults = (html: string, logger?: IMastraLogger) => {
  logger?.info("📝 [PriceSearch] Parsing HTML for German price data...");
  
  const results: Array<{
    title: string;
    price: string;
    originalAmount: number;
    originalCurrency: string;
    priceEUR: number;
    seller: string;
    link?: string;
    isGermanSeller: boolean;
    needsCurrencyConversion: boolean;
  }> = [];

  try {
    // Extract price patterns with focus on Euro (€999.00, €1.234,56, 999€)
    const pricePattern = /€\s*[\d.,]+|[\d.,]+\s*€|\$[\d.,]+|£[\d.,]+/g;
    const prices = html.match(pricePattern) || [];
    
    // Extract product titles
    const titlePattern = /<h3[^>]*>([^<]+)<\/h3>/g;
    const titles: string[] = [];
    let titleMatch;
    while ((titleMatch = titlePattern.exec(html)) !== null) {
      titles.push(titleMatch[1]);
    }
    
    // Extract seller/domain information
    const linkPattern = /https?:\/\/([^"\s\/]+)/g;
    const domains: string[] = [];
    let linkMatch;
    while ((linkMatch = linkPattern.exec(html)) !== null) {
      domains.push(linkMatch[1]);
    }
    
    // Process results with preference for German sellers
    const maxResults = Math.min(10, Math.min(prices.length, titles.length));
    for (let i = 0; i < maxResults; i++) {
      if (prices[i] && titles[i]) {
        const priceText = prices[i];
        const domain = domains[i] || 'unknown';
        const isGermanSeller = domain.endsWith('.de') || domain.includes('deutschland') || domain.includes('german');
        
        // Detect currency and extract amount with proper EU number format handling
        let originalCurrency = 'EUR';
        let originalAmount = 0;
        let priceEUR = 0;
        
        // Detect currency symbol
        if (priceText.includes('€')) {
          originalCurrency = 'EUR';
        } else if (priceText.includes('$')) {
          originalCurrency = 'USD';
        } else if (priceText.includes('£')) {
          originalCurrency = 'GBP';
        } else if (priceText.includes('CHF')) {
          originalCurrency = 'CHF';
        }
        
        // Extract numeric value with proper EU format handling
        let cleanPrice = priceText.replace(/[^\d.,]/g, '');
        
        // Handle EU format (e.g., "1.234,56" or "1 234,56")
        if (cleanPrice.includes(',') && cleanPrice.lastIndexOf(',') > cleanPrice.lastIndexOf('.')) {
          // EU format: comma is decimal separator, dots/spaces are thousands
          cleanPrice = cleanPrice.replace(/[.\s]/g, '').replace(',', '.');
        } else if (cleanPrice.includes('.') && !cleanPrice.includes(',')) {
          // US format: dot is decimal separator
          // Remove all dots except the last one (decimal)
          const parts = cleanPrice.split('.');
          if (parts.length > 2) {
            cleanPrice = parts.slice(0, -1).join('') + '.' + parts[parts.length - 1];
          }
        }
        
        originalAmount = parseFloat(cleanPrice);
        
        if (!isNaN(originalAmount)) {
          if (originalCurrency === 'EUR') {
            priceEUR = originalAmount;
          } else {
            // Use rough conversion for display, but mark for proper conversion
            const roughRates: { [key: string]: number } = {
              'USD': 0.85,
              'GBP': 1.15,
              'CHF': 0.95
            };
            priceEUR = originalAmount * (roughRates[originalCurrency] || 1);
          }
        }
        
        results.push({
          title: titles[i].trim(),
          price: priceText,
          originalAmount,
          originalCurrency,
          priceEUR,
          seller: domain,
          isGermanSeller,
          needsCurrencyConversion: originalCurrency !== 'EUR',
        });
      }
    }
    
    // Sort by German sellers first, then by price
    results.sort((a, b) => {
      if (a.isGermanSeller && !b.isGermanSeller) return -1;
      if (!a.isGermanSeller && b.isGermanSeller) return 1;
      return a.priceEUR - b.priceEUR;
    });
    
    const germanResults = results.filter(r => r.isGermanSeller);
    logger?.info("📝 [PriceSearch] Extracted price results", { 
      total: results.length, 
      germanSellers: germanResults.length 
    });
    
  } catch (error) {
    logger?.error("❌ [PriceSearch] Error parsing HTML", { error });
  }

  return results;
};

const generatePriceSummary = (results: Array<{title: string; price: string; originalAmount: number; originalCurrency: string; priceEUR: number; seller: string; isGermanSeller: boolean; needsCurrencyConversion: boolean}>, logger?: IMastraLogger) => {
  if (results.length === 0) {
    return "Keine Preisinformationen gefunden. Bitte versuchen Sie eine manuelle Suche auf Google Shopping oder deutschen Uhren-Händler-Websites.";
  }

  const germanResults = results.filter(r => r.isGermanSeller && r.priceEUR > 0);
  const allResults = results.filter(r => r.priceEUR > 0);
  
  if (germanResults.length === 0 && allResults.length === 0) {
    return "Preisinformationen wurden gefunden, konnten aber nicht korrekt verarbeitet werden. Bitte prüfen Sie den Google Shopping Link für aktuelle Preise.";
  }

  // Prefer German results, fall back to all results
  const targetResults = germanResults.length >= 2 ? germanResults : allResults;
  const prices = targetResults.map(r => r.priceEUR).sort((a, b) => a - b);

  const lowest = prices[0];
  const highest = prices[prices.length - 1];
  const average = prices.reduce((sum, price) => sum + price, 0) / prices.length;
  const germanCount = germanResults.length;

  logger?.info("📝 [PriceSearch] Generated price summary", { 
    lowest, highest, average, 
    totalResults: results.length,
    germanResults: germanCount 
  });

  // Use proper German locale formatting for Euro prices
  const formatEUR = (amount: number) => {
    return new Intl.NumberFormat('de-DE', { 
      style: 'currency', 
      currency: 'EUR' 
    }).format(amount);
  };
  
  let summary = `Preisvergleich basierend auf ${results.length} Angeboten gefunden`;
  if (germanCount > 0) {
    summary += ` (davon ${germanCount} deutsche Händler)`;
  }
  summary += `:
• Niedrigster Preis: ${formatEUR(lowest)}
• Höchster Preis: ${formatEUR(highest)}
• Durchschnittspreis: ${formatEUR(average)}

Top Angebote:`;
  
  const topResults = germanResults.length >= 3 ? germanResults.slice(0, 3) : targetResults.slice(0, 3);
  topResults.forEach((r, i) => {
    const flag = r.isGermanSeller ? '🇩🇪' : '🌍';
    summary += `\n${i + 1}. ${flag} ${r.title} - ${formatEUR(r.priceEUR)} (${r.seller})`;
  });
  
  if (germanCount === 0) {
    summary += `\n\n⚠️ Keine deutschen Händler gefunden. Preise sind aus internationalen Quellen und können Versandkosten/Zoll enthalten.`;
  }

  return summary;
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
      originalAmount: z.number(),
      originalCurrency: z.string(),
      priceEUR: z.number(),
      seller: z.string(),
      isGermanSeller: z.boolean(),
      needsCurrencyConversion: z.boolean(),
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