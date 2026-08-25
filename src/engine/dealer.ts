/**
 * The dealer: assigns proposed colonies to characters, honoring
 *   - per-character planet budgets (1 + Interplanetary Consolidation),
 *   - one colony per character per planet,
 *   - per-colony Command Center Upgrades requirements.
 *
 * This is a constrained bipartite matching, and greedy heuristics fail on
 * feasible worlds (proven by Gate 4's scale sweep), so it is solved with
 * augmenting paths (Kuhn's algorithm): if a valid assignment exists, the
 * dealer finds it; if none exists, the refusal is named. v8's dealer ignored
 * the caps entirely and shipped plans its own judge refused.
 */
import { maxPlanets, type Operation } from '../world/characters.js';

export interface Assignable {
  readonly planetName: string;
  /** Smallest CC upgrade level whose CPU/PG fits this colony's layout. */
  readonly minCcuLevel: number;
}

export interface Assignment {
  readonly characterName: string;
  readonly ccuLevel: number;
}

export function deal(
  op: Operation,
  colonies: ReadonlyArray<Assignable>,
): { assignments: Assignment[] } | { error: string } {
  const chars = op.characters;
  const budget = chars.map((c) => maxPlanets(c));
  const totalBudget = budget.reduce((a, b) => a + b, 0);
  if (colonies.length > totalBudget) {
    return { error: `dealer-slots: ${colonies.length} colonies exceed the operation's ${totalBudget} slots` };
  }
  const planetCount = new Map<string, number>();
  for (const c of colonies) planetCount.set(c.planetName, (planetCount.get(c.planetName) ?? 0) + 1);
  for (const [planet, n] of planetCount) {
    if (n > chars.length) {
      return { error: `dealer-planet-capacity: ${n} colonies on ${planet} but only ${chars.length} characters (one colony per character per planet)` };
    }
  }

  // State: owner[i] = char index of colony i; heldCount, heldOnPlanet per char.
  const owner: number[] = new Array(colonies.length).fill(-1);
  const heldCount: number[] = new Array(chars.length).fill(0);
  const heldOnPlanet: Array<Map<string, number>> = chars.map(() => new Map()); // planet -> colony idx

  const eligible = (colonyIdx: number, charIdx: number): boolean =>
    chars[charIdx]!.ccuLevel >= colonies[colonyIdx]!.minCcuLevel;

  const assign = (i: number, c: number): void => {
    owner[i] = c;
    heldCount[c]!++;
    heldOnPlanet[c]!.set(colonies[i]!.planetName, i);
  };
  const unassign = (i: number): void => {
    const c = owner[i]!;
    owner[i] = -1;
    heldCount[c]!--;
    heldOnPlanet[c]!.delete(colonies[i]!.planetName);
  };

  /** Kuhn augmenting search: place colony i, relocating blockers if needed. */
  const tryPlace = (i: number, visited: Set<number>): boolean => {
    for (let c = 0; c < chars.length; c++) {
      if (!eligible(i, c)) continue;
      const planet = colonies[i]!.planetName;
      const planetBlocker = heldOnPlanet[c]!.get(planet);
      if (planetBlocker === undefined && heldCount[c]! < budget[c]!) {
        assign(i, c);
        return true;
      }
      // Blocked: try to relocate one blocking colony held by this character.
      const blockers: number[] = [];
      if (planetBlocker !== undefined) {
        blockers.push(planetBlocker);
      } else {
        for (const j of heldOnPlanet[c]!.values()) blockers.push(j); // budget-full: any held colony
      }
      for (const j of blockers) {
        if (visited.has(j)) continue;
        visited.add(j);
        unassign(j);
        assign(i, c);
        if (tryPlace(j, visited)) return true;
        unassign(i);
        assign(j, c);
      }
    }
    return false;
  };

  // Hardest colonies first: highest CCU demand, then most-contended planet.
  const order = colonies
    .map((col, idx) => ({ idx, need: col.minCcuLevel, contention: planetCount.get(col.planetName)! }))
    .sort((a, b) => (b.need - a.need) || (b.contention - a.contention));
  for (const { idx, need } of order) {
    if (!tryPlace(idx, new Set([idx]))) {
      return { error: `dealer-planet-capacity: no assignment exists that gives this colony a character with Command Center Upgrades >= ${need} and a free slot on ${colonies[idx]!.planetName}` };
    }
  }
  return {
    assignments: owner.map((c) => ({ characterName: chars[c]!.name, ccuLevel: chars[c]!.ccuLevel })),
  };
}
