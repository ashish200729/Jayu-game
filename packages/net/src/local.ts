import { MatchHost, type HostOptions } from './host';
import { GameClient, type ClientOptions } from './client';
import type { HelloMsg } from './protocol';
import { createLocalPair, realClock, type Clock, type NetConditions, PERFECT } from './transport';

export interface LocalSession {
  host: MatchHost;
  client: GameClient;
  /** Drive both host and client; call every frame. */
  update(now?: number): void;
  close(): void;
}

/**
 * Offline play: the authoritative host runs in-process and talks to the client through an in-memory
 * transport (optionally with simulated network conditions for the dev network simulator).
 */
export function createLocalSession(
  hostOpts: Omit<HostOptions, 'kind' | 'code'> & { code?: string },
  hello: Omit<HelloMsg, 'v'>,
  conditions: NetConditions = PERFECT,
  clientOpts: ClientOptions = {},
  clock: Clock = realClock,
): LocalSession {
  const host = new MatchHost({ kind: 'local', code: hostOpts.code ?? 'LOCAL', autoStart: true, ...hostOpts, clock });
  const pair = createLocalPair(
    (d) => host.receive('local', d),
    () => host.disconnect('local'),
    conditions,
    clock,
  );
  host.connect('local', pair.link);
  const client = new GameClient(pair.client, hello, { clock, ...clientOpts });
  return {
    host,
    client,
    update(now = clock.now()) {
      host.update(now);
      client.update(now);
    },
    close() {
      client.leave();
      host.close();
    },
  };
}
