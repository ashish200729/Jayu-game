/** Growable little-endian byte writer with varints. Reused buffers avoid allocations per message. */
export class ByteWriter {
  buf: Uint8Array;
  view: DataView;
  pos = 0;

  constructor(size = 1024) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }

  reset(): this {
    this.pos = 0;
    return this;
  }

  private ensure(n: number): void {
    if (this.pos + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.pos + n) size *= 2;
    const nb = new Uint8Array(size);
    nb.set(this.buf.subarray(0, this.pos));
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }

  u8(v: number): void {
    this.ensure(1);
    this.buf[this.pos++] = v & 0xff;
  }

  i8(v: number): void {
    this.u8(v < 0 ? v + 256 : v);
  }

  u16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v & 0xffff, true);
    this.pos += 2;
  }

  i16(v: number): void {
    this.ensure(2);
    this.view.setInt16(this.pos, v, true);
    this.pos += 2;
  }

  u32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v >>> 0, true);
    this.pos += 4;
  }

  f64(v: number): void {
    this.ensure(8);
    this.view.setFloat64(this.pos, v, true);
    this.pos += 8;
  }

  /** Unsigned LEB128 varint (0..2^35). */
  uv(v: number): void {
    if (v < 0) v = 0;
    this.ensure(6);
    while (v >= 0x80) {
      this.buf[this.pos++] = (v & 0x7f) | 0x80;
      v = Math.floor(v / 128);
    }
    this.buf[this.pos++] = v;
  }

  /** Zigzag signed varint. */
  sv(v: number): void {
    this.uv(v >= 0 ? v * 2 : -v * 2 - 1);
  }

  bytes(b: Uint8Array): void {
    this.ensure(b.length);
    this.buf.set(b, this.pos);
    this.pos += b.length;
  }

  str(s: string): void {
    const b = new TextEncoder().encode(s);
    this.uv(b.length);
    this.bytes(b);
  }

  /** Copy of the written bytes. */
  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

export class DecodeError extends Error {}

export class ByteReader {
  private view: DataView;
  pos = 0;

  constructor(private buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get remaining(): number {
    return this.buf.length - this.pos;
  }

  private need(n: number): void {
    if (this.pos + n > this.buf.length) throw new DecodeError('truncated message');
  }

  u8(): number {
    this.need(1);
    return this.buf[this.pos++];
  }

  i8(): number {
    const v = this.u8();
    return v > 127 ? v - 256 : v;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }

  uv(): number {
    let result = 0;
    let mult = 1;
    for (let i = 0; i < 6; i++) {
      const b = this.u8();
      result += (b & 0x7f) * mult;
      if ((b & 0x80) === 0) return result;
      mult *= 128;
    }
    throw new DecodeError('varint too long');
  }

  sv(): number {
    const u = this.uv();
    return u % 2 === 0 ? u / 2 : -(u + 1) / 2;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const b = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return b;
  }

  str(max = 4096): string {
    const n = this.uv();
    if (n > max) throw new DecodeError('string too long');
    return new TextDecoder().decode(this.bytes(n));
  }
}
