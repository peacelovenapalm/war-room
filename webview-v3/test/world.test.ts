import { describe, expect, it } from 'vitest';

import {
  buildProps,
  DEFAULT_COLS,
  DESK_SLOTS,
  deskRotation,
  FLOOR_SPRITE_NAMES,
  floorSpriteName,
  type Occupant,
  occupantPoseFor,
  outfitForAgent,
  STATIC_PROP_SPRITE_NAMES,
  STATIC_PROPS,
  WALL_SEGMENTS,
  wallSpriteName,
  WORKER_OUTFITS,
  workerSpriteName,
} from '../src/engine/world';

function occupant(overrides: Partial<Occupant> = {}): Occupant {
  return {
    agentId: 1,
    name: 'agent-1',
    statusGlyph: '▶',
    statusWord: 'WORKING',
    loud: false,
    ...overrides,
  };
}

describe('deskRotation', () => {
  it('left wing (tileX < aisle) faces east, right wing faces west — wings face each other', () => {
    expect(deskRotation(3)).toBe('E');
    expect(deskRotation(5)).toBe('E');
    expect(deskRotation(9)).toBe('W');
    expect(deskRotation(11)).toBe('W');
  });

  it('every real desk slot resolves to a rotation', () => {
    for (const slot of DESK_SLOTS) {
      expect(['N', 'E', 'S', 'W']).toContain(deskRotation(slot.tileX));
    }
  });
});

describe('occupantPoseFor', () => {
  it('WORKING -> type (streaming output)', () => {
    expect(occupantPoseFor(occupant({ statusWord: 'WORKING' }))).toBe('type');
  });
  it('loud (needs-input/failed) -> blocked, regardless of statusWord', () => {
    expect(occupantPoseFor(occupant({ statusWord: 'NEEDS INPUT', loud: true }))).toBe('blocked');
    expect(occupantPoseFor(occupant({ statusWord: 'FAILED', loud: true }))).toBe('blocked');
  });
  it('quiet non-working states -> sit', () => {
    expect(occupantPoseFor(occupant({ statusWord: 'DONE', loud: false }))).toBe('sit');
    expect(occupantPoseFor(occupant({ statusWord: 'WAITING', loud: false }))).toBe('sit');
    expect(occupantPoseFor(occupant({ statusWord: 'STOPPED', loud: false }))).toBe('sit');
  });
});

describe('outfitForAgent', () => {
  it('is deterministic and stable for the same agent id', () => {
    expect(outfitForAgent(7)).toBe(outfitForAgent(7));
  });
  it('always returns one of the 4 authored outfits', () => {
    for (const id of [0, 1, 2, 3, 4, 5, 99, -3]) {
      expect(WORKER_OUTFITS).toContain(outfitForAgent(id));
    }
  });
});

describe('workerSpriteName', () => {
  it('composes outfit.pose (matches the real characters.manifest.json naming)', () => {
    expect(workerSpriteName('teal', 'type')).toBe('worker_teal.type');
    expect(workerSpriteName('rust', 'walk')).toBe('worker_rust.walk');
  });
});

describe('floorSpriteName / wallSpriteName', () => {
  it('picks one of the 3 authored floor variants for every tile', () => {
    for (let x = 0; x < DEFAULT_COLS; x++) {
      for (let y = 0; y < 6; y++) {
        expect(FLOOR_SPRITE_NAMES).toContain(floorSpriteName(x, y));
      }
    }
  });

  it('corner at the west end, straight runs otherwise, windows at the authored gaps', () => {
    expect(wallSpriteName(0)).toBe('wall_corner');
    expect(wallSpriteName(4)).toBe('wall_window');
    expect(wallSpriteName(10)).toBe('wall_window');
    expect(wallSpriteName(1)).toBe('wall_straight');
  });
});

describe('WALL_SEGMENTS layout', () => {
  it('spans the full width along the north edge, no gaps', () => {
    expect(WALL_SEGMENTS).toHaveLength(DEFAULT_COLS);
    expect(WALL_SEGMENTS.every((w) => w.tileY === 0 && w.kind === 'wall')).toBe(true);
    expect(new Set(WALL_SEGMENTS.map((w) => w.tileX)).size).toBe(DEFAULT_COLS);
  });

  it('does not share a tile with any desk slot or static prop', () => {
    const wallTiles = new Set(WALL_SEGMENTS.map((w) => `${String(w.tileX)},${String(w.tileY)}`));
    for (const p of [...DESK_SLOTS, ...STATIC_PROPS]) {
      expect(wallTiles.has(`${String(p.tileX)},${String(p.tileY)}`)).toBe(false);
    }
  });
});

describe('buildProps', () => {
  it('includes every desk slot, static prop, and wall segment exactly once', () => {
    const props = buildProps([]);
    expect(props).toHaveLength(DESK_SLOTS.length + STATIC_PROPS.length + WALL_SEGMENTS.length);
  });

  it('attaches the wing-facing rotation to each desk', () => {
    const props = buildProps([]);
    const first = props.find((p) => p.kind === 'desk' && p.tileX === 3 && p.tileY === 2);
    expect(first?.rotation).toBe('E');
  });
});

describe('STATIC_PROP_SPRITE_NAMES', () => {
  it('covers the floor, wall, desk, and prop catalog needed from frame 1', () => {
    for (const name of [
      'floor_tile',
      'floor_tile_b',
      'floor_tile_c',
      'wall_straight',
      'wall_corner',
      'wall_window',
      'desk_monitor',
      'office_chair',
      'plant',
      'coffee_station',
    ]) {
      expect(STATIC_PROP_SPRITE_NAMES).toContain(name);
    }
  });
});
