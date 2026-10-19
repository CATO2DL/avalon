import { validateConfig } from './config.ts';
import { RuleError } from './errors.ts';
import type { DeepReadonly, Game, GameState, Player } from './types.ts';

export type RandomIndex = (upperExclusive: number) => number;

export function deepFreeze<T>(value: T): DeepReadonly<T> {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value as DeepReadonly<T>;
}

export function secureIndex(upperExclusive: number): number {
  // Rejection sampling avoids modulo bias. No time seed / Math.random fallback.
  const limit = 0x100000000 - (0x100000000 % upperExclusive);
  let n: number;
  do { n = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]!; } while (n >= limit);
  return n % upperExclusive;
}

/** Internal construction hook; only the separate testing entry injects a seeded RNG. */
export function constructGame(config: unknown, players: unknown, randomIndex: RandomIndex, id: string): Game {
  const c = validateConfig(config);
  if (!Array.isArray(players) || players.length !== c.playerCount) throw new RuleError('INVALID_PLAYERS');
  const seats: Player[] = Array.from(players, (p: unknown) => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new RuleError('INVALID_PLAYERS');
    const item = p as Record<string, unknown>;
    if (Object.keys(item).some(k => k !== 'id' && k !== 'name') ||
        typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id) ||
        typeof item.name !== 'string' || !item.name.trim() || item.name.length > 80) {
      throw new RuleError('INVALID_PLAYERS');
    }
    return { id: item.id, name: item.name };
  });
  if (new Set(seats.map(p => p.id)).size !== seats.length) throw new RuleError('INVALID_PLAYERS');
  const deck = [...c.roles];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    [deck[i], deck[j]] = [deck[j]!, deck[i]!];
  }
  const leaderIndex = randomIndex(seats.length);
  const game: GameState = {
    id, config: c, players: seats,
    roles: seats.map((p, i) => ({ playerId: p.id, role: deck[i]! })),
    version: 0, phase: 'proposal', leaderIndex, questNumber: 1, team: [],
    rejectionCount: 0, votes: [], questCards: [], quests: [], processedRequests: [], outcome: null,
    events: [{ type: 'game_created', leaderId: seats[leaderIndex]!.id, sequence: 0, version: 0 }],
  };
  return deepFreeze(game);
}
