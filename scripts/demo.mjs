import { pathToFileURL } from 'node:url';
import { applyAction, getPublicView, getPlayerView } from '../src/index.ts';
import { createTestGame } from '../src/testing.ts';

export function runDemo(playerCount = 6, seed = 42, roleSet = 'base') {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `玩家 ${i + 1}` }));
  let game = createTestGame({ playerCount, roleSet }, players, seed);
  let steps = 0;
  while (game.phase !== 'ended') {
    let submitted = false;
    for (const p of players) {
      // Each script player sees only their own projection and legal choices.
      const view = getPlayerView(game, p.id);
      const legal = view.legalActions[0];
      if (!legal) continue;
      let payload;
      switch (legal.type) {
        case 'propose_team': {
          const start = view.public.questNumber - 1;
          const rotated = [...legal.candidateIds.slice(start), ...legal.candidateIds.slice(0, start)];
          payload = { type: legal.type, team: rotated.slice(0, legal.teamSize) }; break;
        }
        case 'vote': payload = { type: legal.type, vote: 'approve' }; break;
        case 'quest_card': payload = { type: legal.type, card: legal.choices.includes('fail') ? 'fail' : 'success' }; break;
        case 'assassinate': payload = { type: legal.type, targetId: legal.candidateIds[0] }; break;
      }
      const result = applyAction(game, p.id, { ...payload, gameId: legal.gameId, expectedVersion: legal.expectedVersion, requestId: `demo-${steps}` });
      if (!result.ok) throw new Error(`Demo action rejected: ${result.error}`);
      game = result.game;
      steps++;
      submitted = true;
      break;
    }
    if (!submitted || steps > 300) throw new Error('Demo stalled');
  }
  return { steps, view: getPublicView(game) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log('测试脚本演示：固定种子、简单合法动作玩家；不是正式 AI，不代表真人试玩。');
  for (const n of [5, 6, 7, 8, 9, 10]) {
    const { steps, view } = runDemo(n,42,'recommended');
    console.log(JSON.stringify({ players: n, actions: steps, score: view.score, outcome: view.outcome, quests: view.quests }, null, 2));
  }
}
