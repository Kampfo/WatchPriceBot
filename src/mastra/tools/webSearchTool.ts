import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

const priceSchema = z.object({
  raw: z.string(),
  value: z.number(),
  currency: z.literal("EUR"),
  isApproximate: z.boolean(),
  isRange: z.boolean(),
  context: z.string().optional(),
});

const structuredResultSchema = z.object({
  position: z.number(),
  title: z.string(),
  url: z.string(),
  excerpt: z.string(),
  publishedDate: z.string().nullable(),
  score: z.number().nullable(),
  detectedPrices: z.array(priceSchema),
  cheapestPrice: priceSchema.nullable(),
  isSoldListing: z.boolean(),
  seller: z.string().nullable(),
  domain: z.string().nullable(),
});

const searchResultSchema = z.object({
  query: z.string(),
  platform: z.string(),
  includeDomains: z.array(z.string()).optional(),
  isSoldQuery: z.boolean(),
  results: z.array(structuredResultSchema),
  tavilyAnswer: z.string().nullable(),
  totalResults: z.number(),
  success: z.boolean(),
  startedAt: z.string(),
  completedAt: z.string(),
  error: z.string().optional(),
});

const cheapestOfferSchema = z.object({
  platform: z.string(),
  title: z.string(),
  url: z.string(),
  price: priceSchema,
  isSoldListing: z.boolean(),
  excerpt: z.string(),
});

type PriceDetection = z.infer<typeof priceSchema>;
type StructuredResult = z.infer<typeof structuredResultSchema>;
type SearchResult = z.infer<typeof searchResultSchema>;

type SearchDefinition = {
  platform: string;
  query: string;
  includeDomains?: string[];
  isSoldQuery?: boolean;
  description?: string;
};

const curatedRetailerDomains = [
  "chrono-exklusive.de",
  "watch.de",
  "uhrenlounge.de",
  "juwelier-brogle.de",
  "christ.de",
  "wempe.com",
  "bucherer.com",
  "blome-uhren.de",
];

const EURO_PRICE_REGEXES = [
  /€\s?\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?/gi,
  /\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?\s?€/gi,
  /EUR\s?\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?/gi,
  /\d{1,3}(?:[\.\s]\d{3})*(?:,\d{1,2})?\s?EUR/gi,
];

const APPROX_TERMS = ["ca", "circa", "etwa", "ungefähr", "approx", "~", "ab"];
const RANGE_TERMS = ["-", "–", "bis"];

const MIN_RELEVANT_PRICE = 100;

const formatEuro = (value: number): string =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);

const normaliseWhitespace = (text: string): string => text.replace(/\s+/g, " ").trim();

const parseEuroValue = (raw: string): number | null => {
  let normalised = raw.replace(/\u00A0/g, " ");
  normalised = normalised.replace(/,-/g, "");
  normalised = normalised.replace(/[^0-9,\.]/g, "");
  if (!normalised) {
    return null;
  }
  const parts = normalised.split(",");
  if (parts.length > 2) {
    // remove thousand separators such as 1,234,567,89
    normalised = normalised.replace(/,/g, ".");
  }
  normalised = normalised.replace(/\./g, "");
  normalised = normalised.replace(/,/g, ".");
  const value = Number.parseFloat(normalised);
  return Number.isFinite(value) ? value : null;
};

const extractEuroPrices = (text: string): PriceDetection[] => {
  if (!text) {
    return [];
  }
  const matches = new Map<string, PriceDetection>();
  for (const regex of EURO_PRICE_REGEXES) {
    regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      const raw = normaliseWhitespace(match[0]);
      if (!raw) {
        continue;
      }
      const value = parseEuroValue(raw);
      if (!value || value < MIN_RELEVANT_PRICE) {
        continue;
      }
      const start = Math.max(0, match.index - 80);
      const end = Math.min(text.length, match.index + raw.length + 80);
      const context = normaliseWhitespace(text.slice(start, end));
      const rawLower = raw.toLowerCase();
      const contextLower = context.toLowerCase();
      const isApproximate = APPROX_TERMS.some(term =>
        rawLower.includes(term) || contextLower.includes(term)
      );
      const isRange = RANGE_TERMS.some(term => raw.includes(term) || context.includes(term));
      const key = `${match.index}-${raw}`;
      if (!matches.has(key)) {
        matches.set(key, {
          raw,
          value,
          currency: "EUR",
          isApproximate,
          isRange,
          context,
        });
      }
    }
  }
  return Array.from(matches.values()).sort((a, b) => a.value - b.value);
};

const buildSearchDefinitions = (searchQuery: string): SearchDefinition[] => [
  {
    platform: "eBay Deutschland (Aktive Listings)",
    query: `${searchQuery} uhr preis sofortkauf Deutschland`,
    includeDomains: ["ebay.de"],
  },
  {
    platform: "eBay Deutschland (Verkaufte Artikel)",
    query: `${searchQuery} uhr verkauft realistisch Preis`,
    includeDomains: ["ebay.de"],
    isSoldQuery: true,
  },
  {
    platform: "Chrono24 Deutschland",
    query: `${searchQuery} preis haendler deutschland`,
    includeDomains: ["chrono24.de", "chrono24.com"],
  },
  {
    platform: "Deutsche Konzessionäre & Juweliere",
    query: `${searchQuery} preis juwelier deutschland angebot`,
    includeDomains: curatedRetailerDomains,
  },
];

const safeHostname = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }
  try {
    const hostname = new URL(url).hostname;
    return hostname ? hostname.replace(/^www\./, "") : null;
  } catch {
    return null;
  }
};

const mapResultToStructured = (
  result: any,
  index: number,
  searchDefinition: SearchDefinition
): StructuredResult => {
  const title = result?.title || "Ohne Titel";
  const url = result?.url || "";
  const snippet = result?.content || result?.snippet || "";
  const excerpt = snippet ? snippet.slice(0, 500) : "";
  const priceText = `${title}\n${snippet}`;
  const detectedPrices = extractEuroPrices(priceText);
  const cheapestPrice =
    detectedPrices.length > 0
      ? detectedPrices.reduce((lowest, current) =>
          current.value < lowest.value ? current : lowest
        )
      : null;
  const combinedText = `${title} ${snippet}`.toLowerCase();
  const isSoldListing = Boolean(
    searchDefinition.isSoldQuery ||
      combinedText.includes("verkauft") ||
      combinedText.includes("sold") ||
      combinedText.includes("beendet")
  );
  const domain = safeHostname(url);

  return {
    position: index + 1,
    title,
    url,
    excerpt,
    publishedDate: result?.published_date ?? null,
    score: typeof result?.score === "number" ? result.score : null,
    detectedPrices,
    cheapestPrice,
    isSoldListing,
    seller: domain,
    domain,
  };
};

const executeSearch = async (
  definition: SearchDefinition,
  logger?: IMastraLogger
): Promise<SearchResult> => {
  const startedAt = new Date();
  try {
    logger?.info("🌐 [WebSearchTool] Executing web search", {
      query: definition.query,
      platform: definition.platform,
      includeDomains: definition.includeDomains,
      isSoldQuery: definition.isSoldQuery ?? false,
    });

    const tavilyResponse = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        api_key: process.env.TAVILY_API_KEY,
        query: definition.query,
        search_depth: "advanced",
        include_answer: true,
        include_results: true,
        include_raw_content: false,
        max_results: 8,
        include_domains: definition.includeDomains ?? [],
        exclude_domains: [],
      }),
    });

    if (!tavilyResponse.ok) {
      throw new Error(`Tavily API error: ${tavilyResponse.status}`);
    }

    const tavilyData = await tavilyResponse.json();
    const resultsArray = Array.isArray(tavilyData?.results) ? tavilyData.results : [];
    const structuredResults = resultsArray.map((result: any, index: number) =>
      mapResultToStructured(result, index, definition)
    );
    const completedAt = new Date();

    logger?.info("✅ [WebSearchTool] Search completed", {
      platform: definition.platform,
      totalResults: structuredResults.length,
    });

    return {
      query: definition.query,
      platform: definition.platform,
      includeDomains: definition.includeDomains,
      isSoldQuery: Boolean(definition.isSoldQuery),
      results: structuredResults,
      tavilyAnswer: tavilyData?.answer ?? null,
      totalResults: resultsArray.length,
      success: true,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
    };
  } catch (error) {
    const completedAt = new Date();
    logger?.error("❌ [WebSearchTool] Search failed", {
      platform: definition.platform,
      error: error instanceof Error ? error.message : "Unknown error",
    });

    return {
      query: definition.query,
      platform: definition.platform,
      includeDomains: definition.includeDomains,
      isSoldQuery: Boolean(definition.isSoldQuery),
      results: [],
      tavilyAnswer: null,
      totalResults: 0,
      success: false,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

const buildAnalysisPrompt = (
  searchQuery: string,
  searchResults: SearchResult[],
  cheapestOffers: z.infer<typeof cheapestOfferSchema>[]
): string => {
  const sections: string[] = [];
  sections.push(`STRUKTURIERTE MARKT-DATEN FÜR "${searchQuery}"`);

  for (const result of searchResults) {
    const lines: string[] = [];
    lines.push(
      `### ${result.platform} – ${result.success ? `${result.totalResults} Treffer` : "keine verwertbaren Daten"}`
    );
    if (!result.success) {
      lines.push(`- Fehler: ${result.error ?? "Unbekannter Fehler"}`);
    } else if (result.results.length === 0) {
      lines.push("- Keine Ergebnisse mit deutschem Preis gefunden.");
    } else {
      const sortedByPrice = result.results
        .filter(entry => Boolean(entry.cheapestPrice))
        .sort((a, b) =>
          (a.cheapestPrice?.value ?? Number.POSITIVE_INFINITY) -
          (b.cheapestPrice?.value ?? Number.POSITIVE_INFINITY)
        );

      if (sortedByPrice.length === 0) {
        lines.push("- ⚠️ Treffer ohne klaren Euro-Preis – Angebote manuell prüfen.");
      } else {
        const maxEntries = Math.min(3, sortedByPrice.length);
        for (let i = 0; i < maxEntries; i += 1) {
          const entry = sortedByPrice[i];
          const cheapestPrice = entry.cheapestPrice!;
          const priceLabel = `${formatEuro(cheapestPrice.value)}${
            cheapestPrice.isApproximate ? " (ca.)" : ""
          }`;
          const stateLabel = entry.isSoldListing
            ? "verkauft"
            : result.isSoldQuery
              ? "verkauft"
              : "aktiv";
          lines.push(
            `- ${priceLabel} • ${stateLabel} • ${entry.title} • ${entry.url}`
          );
        }
      }

      if (result.tavilyAnswer) {
        lines.push(`- Tavily-Notiz: ${result.tavilyAnswer}`);
      }
      const withoutPrice = result.results.length - sortedByPrice.length;
      if (withoutPrice > 0) {
        lines.push(`- ${withoutPrice} weitere Treffer ohne auswertbaren Preis.`);
      }
    }
    if (result.isSoldQuery) {
      lines.push("(Verkaufte Artikel dienen als Preisanker für die Marktwert-Schätzung.)");
    }
    sections.push(lines.join("\n"));
  }

  if (cheapestOffers.length > 0) {
    sections.push(
      [
        "GÜNSTIGSTE ERMITTELTE ANGEBOTE (nach Preis sortiert)",
        ...cheapestOffers.map(
          (offer, index) =>
            `${index + 1}. ${formatEuro(offer.price.value)}${
              offer.price.isApproximate ? " (ca.)" : ""
            } • ${offer.platform}${offer.isSoldListing ? " – verkauft" : ""} • ${offer.title} • ${offer.url}`
        ),
      ].join("\n")
    );
  } else {
    sections.push("Keine belastbaren Preise gefunden – Agent soll auf Lücken hinweisen.");
  }

  sections.push(
    [
      "ANWEISUNGEN FÜR DIE ANTWORT:",
      "- Priorisiere je Plattform das günstigste AKTIVE Angebot; verkaufte eBay-Artikel als Marktindikator separat nennen.",
      "- Verweise auf die konkreten Links der oben genannten Treffer.",
      "- Preise IMMER im deutschen Format (z.B. €7.950) ausgeben.",
      "- Nutze verkaufte Listings, um Preisempfehlungen zu plausibilisieren.",
      "- Erwähne, falls Plattformen keine verwertbaren Ergebnisse geliefert haben.",
    ].join("\n")
  );

  return sections.join("\n\n");
};

export const webSearchTool = createTool({
  id: "web-search-tool",
  description: `Performs targeted German watch market searches across eBay, Chrono24 and authorised retailers. Returns structured pricing information with the cheapest findings.`,
  inputSchema: z.object({
    searchQuery: z.string().describe("Watch reference number or model for actual web search"),
  }),
  outputSchema: z.object({
    searchQuery: z.string(),
    actualSearchResults: z.array(searchResultSchema),
    totalSearches: z.number(),
    successfulSearches: z.number(),
    cheapestOffers: z.array(cheapestOfferSchema),
    analysisPrompt: z.string(),
    timestamp: z.string(),
  }),
  execute: async ({ context: { searchQuery }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [WebSearchTool] Starting structured web search execution", { searchQuery });

    if (!process.env.TAVILY_API_KEY) {
      const errorMessage = "TAVILY_API_KEY environment variable is required for real web search functionality";
      logger?.error("❌ [WebSearchTool] Missing API key", { error: errorMessage });
      throw new Error(errorMessage);
    }

    const searchDefinitions = buildSearchDefinitions(searchQuery);

    const actualSearchResults = await Promise.all(
      searchDefinitions.map(definition => executeSearch(definition, logger))
    );

    const successfulSearches = actualSearchResults.filter(result => result.success).length;

    const cheapestOffers = actualSearchResults
      .flatMap(result =>
        result.results
          .filter(entry => Boolean(entry.cheapestPrice) && entry.url)
          .map(entry => ({
            platform: result.platform,
            title: entry.title,
            url: entry.url,
            price: entry.cheapestPrice!,
            isSoldListing: entry.isSoldListing,
            excerpt: entry.excerpt,
          }))
      )
      .sort((a, b) => a.price.value - b.price.value)
      .slice(0, 6);

    const analysisPrompt = buildAnalysisPrompt(
      searchQuery,
      actualSearchResults,
      cheapestOffers
    );

    const webSearchData = {
      searchQuery,
      actualSearchResults,
      totalSearches: searchDefinitions.length,
      successfulSearches,
      cheapestOffers,
      analysisPrompt,
      timestamp: new Date().toISOString(),
    };

    logger?.info("✅ [WebSearchTool] All structured web searches completed", {
      totalSearches: webSearchData.totalSearches,
      successfulSearches: webSearchData.successfulSearches,
      searchQuery,
    });

    return webSearchData;
  },
});
