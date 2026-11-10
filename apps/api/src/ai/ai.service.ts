import { Injectable, Logger } from '@nestjs/common';
import { aiClassificationSchema, DEFAULT_PROMPTS, type AiClassification, type AiTask } from '@tp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/crypto.service';
import { AnthropicAdapter, CircuitBreaker, estimateCostUsd, LlmAdapter, LlmError, OpenAiCompatAdapter, withRetry } from './adapters';

export class AiNotConfiguredError extends Error {}
export class AiBudgetExceededError extends Error {}
export class AiOutputError extends Error {}

export interface CompleteInput {
  task: AiTask;
  user: string;
  /** Overrides the configured/default system prompt. */
  system?: string;
  ticketId?: string;
}

/** Port used by the intake pipeline; tests replace it with a fake. */
export abstract class IntakeClassifier {
  abstract classify(maskedText: string, context: string[]): Promise<AiClassification>;
}

@Injectable()
export class AiService extends IntakeClassifier {
  private readonly logger = new Logger('AI');
  /** Public so tests can reset it between cases. */
  breaker = new CircuitBreaker(5, 60_000);
  /** Test seam: replace to avoid real network. */
  adapterFactory: (type: string, apiKey: string, baseUrl: string | null) => LlmAdapter = (type, apiKey, baseUrl) =>
    type === 'ANTHROPIC' ? new AnthropicAdapter(apiKey, baseUrl) : new OpenAiCompatAdapter(apiKey, baseUrl ?? 'https://api.openai.com/v1');
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms));

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {
    super();
  }

  async effectivePrompt(task: Exclude<AiTask, 'embedding'>): Promise<string> {
    const s = await this.prisma.aiSettings.findUnique({ where: { id: 1 } });
    const custom = ((s?.prompts ?? {}) as Record<string, string>)[task];
    return custom?.trim() ? custom : DEFAULT_PROMPTS[task];
  }

  async monthSpendUsd(): Promise<number> {
    const start = new Date();
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
    const r = await this.prisma.aiUsageLog.aggregate({ _sum: { costUsd: true }, where: { createdAt: { gte: start } } });
    return r._sum.costUsd ?? 0;
  }

  /** Raw completion with config loading, budget hard stop, circuit breaker, retries and usage logging. */
  async complete(input: CompleteInput): Promise<string> {
    const settings = await this.prisma.aiSettings.findUnique({ where: { id: 1 } });
    const provider = settings?.providerId ? await this.prisma.aiProvider.findUnique({ where: { id: settings.providerId } }) : null;
    const model =
      input.task === 'classify' ? settings?.classifyModel : input.task === 'draft' ? settings?.draftModel : settings?.summaryModel;
    if (!settings || !provider?.isActive || !model) throw new AiNotConfiguredError('AI provider/model is not configured');

    if (settings.hardStop && settings.monthlyBudgetUsd > 0 && (await this.monthSpendUsd()) >= settings.monthlyBudgetUsd) {
      throw new AiBudgetExceededError('monthly AI budget exhausted');
    }
    if (this.breaker.isOpen) throw new LlmError('AI circuit breaker is open', undefined, false);

    const system = input.system ?? (input.task === 'embedding' ? '' : await this.effectivePrompt(input.task as Exclude<AiTask, 'embedding'>));
    const adapter = this.adapterFactory(provider.type, this.crypto.decrypt(provider.apiKeyEnc), provider.baseUrl);
    const t0 = Date.now();
    try {
      const res = await withRetry(
        () => adapter.complete({ model, system, user: input.user, maxTokens: settings.maxTokens, temperature: settings.temperature, timeoutMs: 20_000 }),
        { retries: 2, baseMs: 400, sleep: this.sleep },
      );
      this.breaker.onSuccess();
      await this.logUsage(input, model, Date.now() - t0, res.inputTokens, res.outputTokens, true);
      return res.text;
    } catch (e) {
      this.breaker.onFailure();
      await this.logUsage(input, model, Date.now() - t0, 0, 0, false, String(e));
      throw e;
    }
  }

  async classify(maskedText: string, context: string[]): Promise<AiClassification> {
    const ctx = context.length ? `<context>\n${context.join('\n')}\n</context>\n` : '';
    const text = await this.complete({ task: 'classify', user: `${ctx}<messages>\n${maskedText}\n</messages>` });
    return parseClassification(text);
  }

  private async logUsage(input: CompleteInput, model: string, latencyMs: number, inT: number, outT: number, ok: boolean, error?: string) {
    try {
      await this.prisma.aiUsageLog.create({
        data: {
          task: input.task,
          model,
          inputTokens: inT,
          outputTokens: outT,
          latencyMs,
          costUsd: estimateCostUsd(model, inT, outT),
          ok,
          error: error?.slice(0, 300),
          ticketId: input.ticketId,
        },
      });
    } catch (e) {
      this.logger.warn(`usage log failed: ${String(e)}`);
    }
  }
}

/** Extract the first JSON object from a model reply (tolerates code fences / prose) and validate it. */
export function parseClassification(text: string): AiClassification {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new AiOutputError('no JSON object in model output');
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new AiOutputError('invalid JSON in model output');
  }
  const r = aiClassificationSchema.safeParse(raw);
  if (!r.success) throw new AiOutputError(`model output failed validation: ${r.error.issues[0]?.message}`);
  return r.data;
}
