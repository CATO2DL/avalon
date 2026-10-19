// TEST / SCRIPT FIXTURES ONLY. Not re-exported from index.ts or accepted by createGame.
import { constructGame } from './internal.ts';
import type { Game, GameConfig, Player } from './types.ts';

export function createTestGame(config: GameConfig, players: readonly Player[], seed: number): Game {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('Test seed must be uint32');
  let state = seed >>> 0;
  const randomIndex = (upperExclusive: number): number => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return Math.floor(state / 0x100000000 * upperExclusive);
  };
  return constructGame(config, players, randomIndex, `test-${config.playerCount}-${seed}`);
}
