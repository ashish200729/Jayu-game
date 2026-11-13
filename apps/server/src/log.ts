/** JSON-lines logging. Never logs personal data: no IPs, no tokens, no free text from players. */
export function log(level: 'info' | 'warn' | 'error', area: string, data: Record<string, unknown>): void {
  const line = JSON.stringify({ t: new Date().toISOString(), level, area, ...data });
  if (level === 'error') console.error(line);
  else if (process.env.LOG_LEVEL !== 'quiet') console.log(line);
}
