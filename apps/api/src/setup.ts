import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter, correlationMiddleware } from './common/http';

/** Shared by main.ts and e2e tests so tests exercise the real HTTP pipeline. */
export function setupApp(app: INestApplication, opts: { swagger?: boolean; corsOrigins?: string } = {}) {
  app.setGlobalPrefix('api/v1', { exclude: [] });
  app.use(correlationMiddleware);
  app.useGlobalFilters(new AllExceptionsFilter());
  const origins = opts.corsOrigins ?? '*';
  app.enableCors({
    origin: origins === '*' ? true : origins.split(',').map((s) => s.trim()),
    allowedHeaders: ['content-type', 'authorization', 'x-correlation-id'],
    exposedHeaders: ['x-correlation-id'],
  });
  app.enableShutdownHooks();
  if (opts.swagger) {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('TP Ticket System API').setVersion('0.1').addBearerAuth().build(),
    );
    SwaggerModule.setup('docs', app, doc);
  }
}
