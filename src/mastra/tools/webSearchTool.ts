import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

export const webSearchTool = createTool({
  id: "web-search-tool",
  description: `Performs ACTUAL web searches to get real current German watch market pricing from eBay Deutschland, Chrono24, and German retailers. Returns actual search results with real market data.`,
  inputSchema: z.object({
    searchQuery: z.string().describe("Watch reference number or model for actual web search"),
  }),
  outputSchema: z.object({
    searchQuery: z.string(),
    actualSearchResults: z.array(z.object({
      query: z.string(),
      platform: z.string(),
      realResults: z.string(),
      success: z.boolean(),
      timestamp: z.string()
    })),
    totalSearches: z.number(),
    successfulSearches: z.number(),
    analysisPrompt: z.string(),
    timestamp: z.string()
  }),
  execute: async ({ context: { searchQuery }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [WebSearchTool] Starting ACTUAL web search execution", { searchQuery });

    // Check for required Tavily API key
    if (!process.env.TAVILY_API_KEY) {
      const errorMessage = "TAVILY_API_KEY environment variable is required for real web search functionality";
      logger?.error("❌ [WebSearchTool] Missing API key", { error: errorMessage });
      throw new Error(errorMessage);
    }

    // Define platform-specific search queries for German watch market
    const searchQueries = [
      {
        query: `${searchQuery} eBay Deutschland preis verkauft sold`,
        platform: "eBay Deutschland"
      },
      {
        query: `${searchQuery} Chrono24 price euro germany dealer`,
        platform: "Chrono24"
      },
      {
        query: `${searchQuery} German watch retailers price EUR authorized dealer`,
        platform: "German Retailers"
      }
    ];

    const actualSearchResults = [];

    // ACTUALLY PERFORM WEB SEARCHES - Get real current market data!
    for (const searchItem of searchQueries) {
      try {
        logger?.info("🌐 [WebSearchTool] Executing REAL web search", { 
          query: searchItem.query,
          platform: searchItem.platform 
        });
        
        // Define platform-specific domain filtering for better targeted results
        let includeDomains: string[] = [];
        if (searchItem.platform === "eBay Deutschland") {
          includeDomains = ['ebay.de'];
        } else if (searchItem.platform === "Chrono24") {
          includeDomains = ['chrono24.com', 'chrono24.de'];
        }
        // For German Retailers, no domain restriction to allow broader German dealer results
        
        // REAL WEB SEARCH EXECUTION using Tavily API - Gets actual current market data
        const tavilyResponse = await fetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            api_key: process.env.TAVILY_API_KEY,
            query: searchItem.query,
            search_depth: 'advanced',
            include_answer: true,
            include_results: true,
            include_raw_content: false,
            max_results: 8,
            include_domains: includeDomains,
            exclude_domains: []
          })
        });

        if (!tavilyResponse.ok) {
          throw new Error(`Tavily API error: ${tavilyResponse.status}`);
        }

        const tavilyData = await tavilyResponse.json();
        
        // Parse Tavily results into structured data the AI agent can analyze
        let structuredResults = '';
        if (tavilyData.results && Array.isArray(tavilyData.results)) {
          structuredResults = tavilyData.results.map((result: any, index: number) => {
            const title = result.title || 'No title';
            const url = result.url || '';
            const snippet = result.content || result.snippet || 'No description';
            const published = result.published_date || 'Date unknown';
            
            return `
RESULT ${index + 1}:
Title: ${title}
URL: ${url}
Content: ${snippet.substring(0, 500)}${snippet.length > 500 ? '...' : ''}
Published: ${published}
---`;
          }).join('\n');
        }
        
        // Include Tavily's AI answer if available
        let aiAnswer = '';
        if (tavilyData.answer) {
          aiAnswer = `\nTAVILY AI ANALYSIS:\n${tavilyData.answer}\n---\n`;
        }
        
        const realSearchResult = `SEARCH PLATFORM: ${searchItem.platform}
QUERY: "${searchItem.query}"
TOTAL RESULTS: ${tavilyData.results ? tavilyData.results.length : 0}

${aiAnswer}${structuredResults}

RAW_QUERY_INFO: ${tavilyData.query || searchItem.query}`;
        
        actualSearchResults.push({
          query: searchItem.query,
          platform: searchItem.platform,
          realResults: realSearchResult,
          success: true,
          timestamp: new Date().toISOString()
        });
        
        logger?.info("✅ [WebSearchTool] REAL search completed successfully", { 
          platform: searchItem.platform,
          resultLength: realSearchResult.length 
        });

        // Small delay between searches to be respectful
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        logger?.error("❌ [WebSearchTool] Real web search failed", { 
          platform: searchItem.platform,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
        
        actualSearchResults.push({
          query: searchItem.query,
          platform: searchItem.platform,
          realResults: `Web search failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          success: false,
          timestamp: new Date().toISOString()
        });
      }
    }

    const successfulSearches = actualSearchResults.filter(r => r.success).length;

    const webSearchData = {
      searchQuery,
      actualSearchResults,
      totalSearches: searchQueries.length,
      successfulSearches,
      analysisPrompt: `REAL WEB SEARCH RESULTS FOR: ${searchQuery}

ACTUAL CURRENT MARKET DATA RETRIEVED:

${actualSearchResults.map(result => `
**${result.platform}:**
Search Query: ${result.query}
Status: ${result.success ? '✅ Success' : '❌ Failed'}
Real Market Data: ${result.realResults.substring(0, 1000)}${result.realResults.length > 1000 ? '...[truncated]' : ''}
Retrieved: ${result.timestamp}
---
`).join('\n')}

ANALYSIS INSTRUCTIONS FOR AI AGENT:
- Above are ACTUAL web search results from current German watch market sources
- Extract specific Euro (€) prices from the real data shown above  
- Look for price ranges, condition factors, and seller information in the actual results
- Focus on German sellers and .de domain results from the real data
- Identify authentication requirements and dealer reputation from actual listings
- Provide concrete price recommendations based on this REAL current market data

SEARCH SUCCESS: ${successfulSearches}/${searchQueries.length} searches completed successfully
GERMAN MARKET FOCUS: EUR pricing from eBay Deutschland, Chrono24, and German retailers

This provides real current market data for comprehensive price analysis.`,
      timestamp: new Date().toISOString()
    };

    logger?.info("✅ [WebSearchTool] All REAL web searches completed", { 
      totalSearches: webSearchData.totalSearches,
      successfulSearches: webSearchData.successfulSearches,
      searchQuery 
    });

    return webSearchData;
  },
});