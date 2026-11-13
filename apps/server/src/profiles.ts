import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Guest profile cloud copies. Identified by a random client-generated id + secret (no personal data).
 * Stored as a JSON file (swap for a database when scaling past one server process).
 */
interface Stored {
  secretHash: string;
  profile: unknown;
  version: number;
  updatedAt: number;
}

export class ProfileStore {
  private data = new Map<string, Stored>();
  private dirty = false;

  constructor(private file: string) {
    if (existsSync(file)) {
      try {
        const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Stored>;
        for (const [k, v] of Object.entries(raw)) this.data.set(k, v);
      } catch {
        // Corrupt store: start empty but keep the bad file for inspection.
        renameSync(file, `${file}.corrupt-${Date.now()}`);
      }
    }
    setInterval(() => this.flush(), 5000).unref();
  }

  private hash(secret: string): string {
    return createHash('sha256').update(secret).digest('hex');
  }

  /** Last-write-wins on the `version` counter the client increments; returns the authoritative copy. */
  sync(id: string, secret: string, profile: unknown, version: number): { ok: boolean; profile?: unknown; version?: number } {
    if (!/^[a-z0-9]{16,48}$/.test(id) || typeof secret !== 'string' || secret.length < 16 || secret.length > 128) return { ok: false };
    const size = JSON.stringify(profile ?? null).length;
    if (size > 64 * 1024) return { ok: false };
    const h = this.hash(secret);
    const cur = this.data.get(id);
    if (cur && cur.secretHash !== h) return { ok: false };
    if (!cur || version > cur.version) {
      this.data.set(id, { secretHash: h, profile, version, updatedAt: Date.now() });
      this.dirty = true;
      return { ok: true, profile, version };
    }
    return { ok: true, profile: cur.profile, version: cur.version };
  }

  delete(id: string, secret: string): boolean {
    const cur = this.data.get(id);
    if (!cur || cur.secretHash !== this.hash(secret)) return false;
    this.data.delete(id);
    this.dirty = true;
    return true;
  }

  get size(): number {
    return this.data.size;
  }

  flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.data)));
    renameSync(tmp, this.file);
  }
}
