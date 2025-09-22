import { createTool } from "@mastra/core/tools";
import type { IMastraLogger } from "@mastra/core/logger";
import { z } from "zod";

const convertToEUR = async ({
  amount,
  fromCurrency,
  logger,
}: {
  amount: number;
  fromCurrency: string;
  logger?: IMastraLogger;
}) => {
  logger?.info("🔧 [CurrencyNormalize] Converting to EUR", { amount, fromCurrency });

  try {
    // If already EUR, no conversion needed
    if (fromCurrency.toUpperCase() === 'EUR' || fromCurrency === '€') {
      return {
        originalAmount: amount,
        originalCurrency: fromCurrency,
        convertedAmount: amount,
        convertedCurrency: 'EUR',
        exchangeRate: 1,
        isConverted: false
      };
    }

    // Fetch exchange rates from exchangerate.host (free, no API key required)
    const response = await fetch(`https://api.exchangerate.host/convert?from=${fromCurrency.toUpperCase()}&to=EUR&amount=${amount}`);
    
    if (!response.ok) {
      throw new Error(`Exchange rate API error: ${response.status}`);
    }

    const data = await response.json();
    
    if (!data.success) {
      throw new Error(`Exchange rate conversion failed: ${data.error || 'Unknown error'}`);
    }

    const convertedAmount = data.result || amount;
    const exchangeRate = data.info?.rate || 1;

    logger?.info("✅ [CurrencyNormalize] Successfully converted currency", {
      from: `${amount} ${fromCurrency}`,
      to: `${convertedAmount.toFixed(2)} EUR`,
      rate: exchangeRate
    });

    return {
      originalAmount: amount,
      originalCurrency: fromCurrency,
      convertedAmount: parseFloat(convertedAmount.toFixed(2)),
      convertedCurrency: 'EUR',
      exchangeRate,
      isConverted: true
    };

  } catch (error) {
    logger?.error("❌ [CurrencyNormalize] Error converting currency", { error, amount, fromCurrency });
    
    // Fallback to rough manual conversion rates
    const fallbackRates: { [key: string]: number } = {
      'USD': 0.85,
      '$': 0.85,
      'GBP': 1.15,
      '£': 1.15,
      'CHF': 0.95,
      'JPY': 0.006,
      '¥': 0.006
    };

    const rate = fallbackRates[fromCurrency.toUpperCase()] || fallbackRates[fromCurrency] || 1;
    const convertedAmount = amount * rate;

    logger?.info("⚠️ [CurrencyNormalize] Using fallback conversion rate", {
      from: `${amount} ${fromCurrency}`,
      to: `${convertedAmount.toFixed(2)} EUR`,
      fallbackRate: rate
    });

    return {
      originalAmount: amount,
      originalCurrency: fromCurrency,
      convertedAmount: parseFloat(convertedAmount.toFixed(2)),
      convertedCurrency: 'EUR',
      exchangeRate: rate,
      isConverted: true,
      isFallback: true
    };
  }
};

export const currencyNormalizeTool = createTool({
  id: "currency-normalize-tool",
  description: "Converts any currency amount to EUR using current exchange rates for consistent German market pricing",
  inputSchema: z.object({
    amount: z.number().describe("The price amount to convert"),
    fromCurrency: z.string().describe("The original currency (USD, GBP, CHF, etc. or symbols like $, £)"),
  }),
  outputSchema: z.object({
    originalAmount: z.number().describe("Original amount before conversion"),
    originalCurrency: z.string().describe("Original currency"),
    convertedAmount: z.number().describe("Amount converted to EUR"),
    convertedCurrency: z.string().describe("Target currency (always EUR)"),
    exchangeRate: z.number().describe("Exchange rate used for conversion"),
    isConverted: z.boolean().describe("Whether conversion was performed"),
    isFallback: z.boolean().optional().describe("Whether fallback rates were used"),
  }),
  execute: async ({ context: { amount, fromCurrency }, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [CurrencyNormalize] Starting execution with params:", { amount, fromCurrency });
    
    return await convertToEUR({ amount, fromCurrency, logger });
  },
});