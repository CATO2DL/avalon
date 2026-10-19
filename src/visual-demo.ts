// Local sandbox only; not exported from the production engine entry point.
import { applyAction, createGame, getPlayerView, getPublicView, getRules, validateConfig, getRecommendedRoles } from './index.ts';
import { createTestGame } from './testing.ts';
import type { ActionPayload, PlayerCount, GameConfig, ResolvedConfig } from './types.ts';
export type DemoScenario = 'sabotage' | 'assassination' | 'rejections';
export type DemoMode = 'public' | 'practice';
export function isDemoScenario(v: unknown): v is DemoScenario {
  return v === 'sabotage' || v === 'assassination' || v === 'rejections';
}
export function createVisualDemo(initialMode: DemoMode = 'public') {
  let count: PlayerCount = 6;
  let mode = initialMode;
  let scenario: DemoScenario = 'sabotage';
  let revision = 0;
  let config: GameConfig = {playerCount:count,roleSet:initialMode==='practice'?'recommended':'base'};
  const makePlayers = () => Array.from({ length: count }, (_, i) => ({ id: `p${i + 1}`, name: `玩家 ${i + 1}` }));
  const makeGame = () => mode === 'practice' ? createGame(config, makePlayers()) : createTestGame(config, makePlayers(), 42);
  let game = makeGame();
  const snapshot = () => ({ revision, scenario, mode, rules: getRules(count), configOptions: [5,6,7,8,9,10].map(n=>({rules:getRules(n),recommendedRoles:getRecommendedRoles(n)})), view: getPublicView(game) });
  const privateView = () => mode === 'practice' ? getPlayerView(game, 'p1') : null;
  function submit(expected: unknown, action: unknown) {
    if (expected !== revision) return { ok: false as const, error: 'STALE_REVISION' };
    if (mode !== 'practice') return { ok: false as const, error: 'NO_PLAYER_SESSION' };
    const result = applyAction(game, 'p1', action);
    if (!result.ok) return result;
    game = result.game; revision++;
    return { ok: true as const, ...snapshot() };
  }
  function change(expected: unknown, nextScenario?: unknown, nextCount: unknown = count, nextMode: unknown = mode, nextRoles?: unknown) {
    if (expected !== revision) return { ok: false as const, error: 'STALE_REVISION' };
    if (nextScenario !== undefined) {
      if (!isDemoScenario(nextScenario)) return { ok: false as const, error: 'INVALID_SCENARIO' };
      if (!Number.isInteger(nextCount) || Number(nextCount) < 5 || Number(nextCount) > 10) return { ok: false as const, error: 'INVALID_COUNT' };
      if (nextMode !== 'practice' && nextMode !== 'public') return { ok: false as const, error: 'INVALID_MODE' };
      let nextConfig: ResolvedConfig;
      try { nextConfig = validateConfig({playerCount:nextCount,...(nextRoles===undefined?{}:{roles:nextRoles})}); }
      catch { return {ok:false as const,error:'INVALID_CONFIG'}; }
      // All validation happens before replacing any current state or configuration.
      config = {playerCount:nextConfig.playerCount,roles:nextConfig.roles};
      scenario = nextScenario; count = nextCount as PlayerCount; mode = nextMode;
      game = makeGame(); revision++;
      return { ok: true as const, ...snapshot() };
    }
    if (game.phase === 'ended') return { ok: false as const, error: 'GAME_ENDED' };
    for (const player of game.players) {
      if (mode === 'practice' && player.id === 'p1') continue;
      const view = getPlayerView(game, player.id);
      const legal = view.legalActions[0];
      if (!legal) continue;
      let payload: ActionPayload;
      switch (legal.type) {
        case 'propose_team': {
          const start = view.public.questNumber - 1;
          const order = [...legal.candidateIds.slice(start), ...legal.candidateIds.slice(0, start)];
          payload = { type: legal.type, team: order.slice(0, legal.teamSize) }; break;
        }
        case 'vote': payload = { type: legal.type, vote: scenario === 'rejections' ? 'reject' : 'approve' }; break;
        case 'quest_card': payload = { type: legal.type, card: scenario === 'sabotage' && legal.choices.includes('fail') ? 'fail' : 'success' }; break;
        case 'assassinate': {
          const targetId = legal.candidateIds[0];
          if (!targetId) throw new Error('No target');
          payload = { type: legal.type, targetId }; break;
        }
      }
      const result = applyAction(game, player.id, { ...payload, gameId: legal.gameId, expectedVersion: legal.expectedVersion, requestId: `script-${revision}` });
      if (!result.ok) throw new Error(result.error);
      game = result.game; revision++;
      return { ok: true as const, ...snapshot() };
    }
    return { ok: false as const, error: 'WAITING_FOR_YOU' };
  }
  return { snapshot, privateView, submit, change };
}
