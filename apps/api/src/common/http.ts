import {
  ArgumentsHost,
  BadRequestException,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  PipeTransform,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { t } from '@tp/shared';
import type { ZodType } from 'zod';

/** Validates a request part with a zod schema (shared with the frontends) and returns the parsed value. */
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}
  transform(value: unknown): T {
    const r = this.schema.safeParse(value);
    if (!r.success) {
      throw new BadRequestException({
        code: 'VALIDATION',
        message: t('error.validation'),
        details: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    return r.data;
  }
}

/** Domain error with a stable machine code and an Uzbek message for the UI. */
export class AppError extends HttpException {
  constructor(status: number, code: string, message: string, details?: unknown) {
    super({ code, message, details }, status);
  }
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const incoming = req.headers['x-correlation-id'];
  const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
  (req as Request & { correlationId: string }).correlationId = id;
  res.setHeader('x-correlation-id', id);
  next();
}

/** One error shape for everything: { statusCode, code, message, details?, correlationId }. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HTTP');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { correlationId?: string }>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL';
    let message = t('error.internal');
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
        code = HttpStatus[status] ?? 'ERROR';
      } else {
        const b = body as Record<string, unknown>;
        code = (b.code as string) ?? HttpStatus[status] ?? 'ERROR';
        message = (Array.isArray(b.message) ? b.message.join('; ') : (b.message as string)) ?? message;
        details = b.details;
      }
    } else {
      // Never leak internals; log with the correlation id (no request bodies at info level).
      this.logger.error(
        `[${req.correlationId}] ${req.method} ${req.url} -> ${exception instanceof Error ? exception.stack : String(exception)}`,
      );
    }
    res.status(status).json({ statusCode: status, code, message, details, correlationId: req.correlationId });
  }
}
