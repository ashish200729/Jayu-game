import { log } from './log';
import { metrics } from './metrics';
import { startServer } from './app';

process.on('uncaughtException', (e) => {
  metrics.errors++;
  log('error', 'process', { msg: String((e as Error)?.stack ?? e) });
});
process.on('unhandledRejection', (e) => {
  metrics.errors++;
  log('error', 'process', { msg: String(e) });
});

const server = await startServer({ port: Number(process.env.PORT ?? 2567) });
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    log('info', 'shutdown', { msg: `received ${sig}` });
    void server.drain().then(() => process.exit(0));
  });
}
