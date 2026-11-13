import { describe, expect, it } from 'vitest';
import { getMap, mapIds, validateMap } from '@game/maps';

describe('maps', () => {
  it('ships 10 maps', () => expect(mapIds()).toHaveLength(10));
  for (const id of mapIds()) {
    it(`${id} passes the validator`, () => {
      const r = validateMap(getMap(id));
      expect(r.errors).toEqual([]);
    });
  }
});
