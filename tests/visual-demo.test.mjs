import test from 'node:test';
import assert from 'node:assert/strict';
import { createVisualDemo } from '../src/visual-demo.ts';

for (const scenario of ['sabotage', 'assassination', 'rejections']) {
  test(`visual script completes ${scenario} using public-only snapshots`, () => {
    const demo = createVisualDemo();
    let state = demo.change(0, scenario);
    let actions = 0;
    const phases = new Set();
    while (state.view.phase !== 'ended') {
      const v = state.view;
      phases.add(v.phase);
      for (const secret of ['roles', 'questCards', 'votes', 'processedRequests', 'self']) assert.equal(secret in v, false);
      if (v.phase === 'voting' && v.submissions.votes > 0) {
        const proposal = v.events.findLast(e => e.type === 'team_proposed');
        assert.equal(v.events.some(e => e.type === 'team_vote_resolved' && e.sequence > proposal.sequence), false);
      }
      if (v.phase === 'quest') {
        assert.equal(v.quests.some(q => q.questNumber === v.questNumber), false);
        assert.equal(v.events.some(e => e.type === 'quest_resolved' && e.questNumber === v.questNumber), false);
      }
      state = demo.change(state.revision);
      assert.equal(state.ok, true);
      assert.ok(++actions < 100);
    }
    const v = state.view;
    if (scenario === 'sabotage') assert.equal(v.outcome.reason, 'three_failed_quests');
    if (scenario === 'rejections') assert.equal(v.outcome.reason, 'five_rejections');
    if (scenario === 'assassination') {
      assert.ok(phases.has('assassination'));
      assert.ok(['assassination_missed', 'merlin_assassinated'].includes(v.outcome.reason));
    }
    assert.deepEqual(demo.change(state.revision), { ok: false, error: 'GAME_ENDED' });
  });
}

test('demo restart invalidates old steps, duplicate steps and invalid scenarios preserve state', () => {
  const demo = createVisualDemo();
  demo.change(0);
  const before = demo.snapshot();
  assert.equal(demo.change(0).error, 'STALE_REVISION');
  assert.equal(demo.change(before.revision, 'invalid').error, 'INVALID_SCENARIO');
  assert.deepEqual(demo.snapshot(), before);
  const reset = demo.change(before.revision, 'sabotage');
  assert.equal(reset.view.version, 0);
  assert.equal(demo.change(before.revision).error, 'STALE_REVISION');
  reset.view.players[0].name = 'changed externally';
  assert.equal(demo.snapshot().view.players[0].name, '玩家 1');
});

