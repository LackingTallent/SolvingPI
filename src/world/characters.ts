/**
 * Characters and operations. Every character is modeled individually
 * (locked decision): own skills, own planet budget. Sum, never multiply.
 * Supported operation size: 1..50 characters, all sizes first-class.
 */
import { BASE_PLANETS_PER_CHARACTER, IC_PLANETS_PER_LEVEL, MAX_CCU_LEVEL, MAX_CHARACTERS, MAX_IC_LEVEL, MIN_CHARACTERS } from '../spec/constants.js';

export interface Character {
  readonly name: string;
  /** Interplanetary Consolidation 0..5 → 1..6 planets. */
  readonly icLevel: number;
  /** Command Center Upgrades 0..5 → max CC upgrade level. */
  readonly ccuLevel: number;
  /** Customs Code Expertise 0..5 → NPC hisec customs reduction. */
  readonly customsCodeLevel: number;
  /** Accounting 0..5 → sales tax reduction. */
  readonly accountingLevel: number;
  /** Broker Relations 0..5 → NPC broker fee reduction. */
  readonly brokerRelationsLevel: number;
}

const CHARACTER_KEYS = ['name', 'icLevel', 'ccuLevel', 'customsCodeLevel', 'accountingLevel', 'brokerRelationsLevel'] as const;

function skillLevel(field: string, v: number, max: number): number {
  if (!Number.isInteger(v) || v < 0 || v > max)
    throw new Error(`character(): ${field} must be an integer 0..${max}, got ${v}`);
  return v;
}

/** Strict constructor: unknown keys throw; skill levels validated. */
export function character(spec: Character): Character {
  const unknown = Object.keys(spec).filter((k) => !(CHARACTER_KEYS as ReadonlyArray<string>).includes(k));
  if (unknown.length > 0) throw new Error(`character(): unknown keys: ${unknown.join(', ')}`);
  if (typeof spec.name !== 'string' || spec.name.length === 0)
    throw new Error('character(): name must be a non-empty string');
  skillLevel('icLevel', spec.icLevel, MAX_IC_LEVEL);
  skillLevel('ccuLevel', spec.ccuLevel, MAX_CCU_LEVEL);
  skillLevel('customsCodeLevel', spec.customsCodeLevel, 5);
  skillLevel('accountingLevel', spec.accountingLevel, 5);
  skillLevel('brokerRelationsLevel', spec.brokerRelationsLevel, 5);
  return spec;
}

/** Planets this character can run: 1 + IC level (max 6). */
export function maxPlanets(c: Character): number {
  return BASE_PLANETS_PER_CHARACTER + IC_PLANETS_PER_LEVEL * c.icLevel;
}

export interface Operation {
  readonly characters: ReadonlyArray<Character>;
}

export function operation(characters: ReadonlyArray<Character>): Operation {
  if (characters.length < MIN_CHARACTERS || characters.length > MAX_CHARACTERS)
    throw new Error(
      `operation(): supported size is ${MIN_CHARACTERS}..${MAX_CHARACTERS} characters, got ${characters.length}`,
    );
  const names = new Set<string>();
  for (const c of characters) {
    character(c);
    if (names.has(c.name)) throw new Error(`operation(): duplicate character name "${c.name}"`);
    names.add(c.name);
  }
  return { characters };
}

/** Total colony slots = SUM of each character's planet budget. Never a multiply. */
export function totalSlots(op: Operation): number {
  return op.characters.reduce((a, c) => a + maxPlanets(c), 0);
}
