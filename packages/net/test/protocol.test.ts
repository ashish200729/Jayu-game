import { describe, expect, it } from 'vitest';
import { ByteReader, ByteWriter, Msg, decodeInputs, encodeInputs, isProfane, sanitizeName, makeInviteCode } from '@game/net';

describe('protocol', () => {
  it('varints round-trip', () => {
    const w = new ByteWriter(8);
    const vals = [0, 1, -1, 127, 128, -300, 2 ** 31, -(2 ** 31), 123456789];
    for (const v of vals) w.sv(v);
    const r = new ByteReader(w.finish());
    for (const v of vals) expect(r.sv()).toBe(v);
  });
  it('inputs round-trip', () => {
    const inputs = [
      { seq: 100, moveX: -127, moveY: 64, aim: 65535, buttons: 15, actions: 0xfffff, throwPower: 200, signal: 33, viewTick: 99999 },
      { seq: 101, moveX: 0, moveY: 0, aim: 0, buttons: 0, actions: 0, throwPower: 0, signal: 0, viewTick: 0 },
    ];
    const bytes = encodeInputs(inputs, 1234);
    const r = new ByteReader(bytes);
    expect(r.u8()).toBe(Msg.Inputs);
    const d = decodeInputs(r);
    expect(d.ack).toBe(1234);
    expect(d.inputs).toEqual(inputs);
  });
  it('rejects truncated messages', () => {
    const bytes = encodeInputs([{ seq: 1, moveX: 0, moveY: 0, aim: 0, buttons: 0, actions: 0, throwPower: 0, signal: 0, viewTick: 0 }], 0);
    const r = new ByteReader(bytes.slice(0, bytes.length - 3));
    r.u8();
    expect(() => decodeInputs(r)).toThrow();
  });
  it('filters names', () => {
    expect(isProfane('b1tch')).toBe(true);
    expect(isProfane('Ch0tiya'.replace('0', 'u'))).toBe(true);
    expect(sanitizeName('  Rocket  Raj ')).toBe('Rocket Raj');
    expect(sanitizeName('<script>')).not.toContain('<');
    expect(makeInviteCode()).toMatch(/^[A-Z2-9]{6}$/);
  });
});
