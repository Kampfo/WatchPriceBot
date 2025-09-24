import { createWorkflow, createStep } from "../inngest";
import { z } from "zod";
import { watchAnalysisAgent } from "../agents/watchAnalysisAgent";

const step1 = createStep({
  id: "use-watch-agent", 
  description: "Analyze watch image and get price information using the watch analysis agent",
  inputSchema: z.object({
    message: z.string(),
    threadId: z.string(),
    chatId: z.string(),
    messageId: z.number(),
  }),
  outputSchema: z.object({
    response: z.string(),
    chatId: z.string(), 
    messageId: z.number(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [WorkflowStep1] Starting agent execution", inputData);

    const { message, threadId, chatId, messageId } = inputData;

    logger?.info("📝 [WorkflowStep1] Calling watch analysis agent...");
    
    const { text } = await watchAnalysisAgent.generate([
      { role: "user", content: `Please analyze this watch image and find price information. ${message}` }
    ], {
      resourceId: "bot",
      threadId: threadId,
      maxSteps: 5,
    });

    logger?.info("✅ [WorkflowStep1] Agent completed successfully");
    
    return { response: text, chatId, messageId };
  }
});

const step2 = createStep({
  id: "send-telegram-reply",
  description: "Send the agent's response back to Telegram",
  inputSchema: z.object({
    response: z.string(),
    chatId: z.string(),
    messageId: z.number(),
  }),
  outputSchema: z.object({
    sent: z.boolean(),
  }),
  execute: async ({ inputData, mastra }) => {
    const logger = mastra?.getLogger();
    logger?.info("🔧 [WorkflowStep2] Starting Telegram message send", inputData);

    const { response, chatId, messageId } = inputData;

    try {
      const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!telegramBotToken) {
        throw new Error("TELEGRAM_BOT_TOKEN not found");
      }

      logger?.info("📝 [WorkflowStep2] Sending message to Telegram...");

      const telegramResponse = await fetch(`https://api.telegram.org/bot${telegramBotToken}/sendMessage`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: response,
          reply_to_message_id: messageId,
        }),
      });

      if (!telegramResponse.ok) {
        const errorText = await telegramResponse.text();
        throw new Error(`Telegram API error: ${telegramResponse.status} - ${errorText}`);
      }

      logger?.info("✅ [WorkflowStep2] Successfully sent message to Telegram");
      return { sent: true };
    } catch (error) {
      logger?.error("❌ [WorkflowStep2] Error sending message to Telegram", { error });
      throw error;
    }
  }
});

const workflowDefinition = createWorkflow({
  id: "watch-analysis-workflow",
  description: "Analyzes watch images and provides price comparisons via Telegram",
  inputSchema: z.object({
    message: z.string(),
    threadId: z.string(),
    chatId: z.string(),
    messageId: z.number(),
  }),
  outputSchema: z.object({
    sent: z.boolean(),
  }),
});

// Type definitions from @mastra/inngest currently expect generic Zod types; explicit casting keeps inference stable.
export const watchAnalysisWorkflow = (workflowDefinition as any)
  .then(step1 as any)
  .then(step2 as any)
  .commit();
