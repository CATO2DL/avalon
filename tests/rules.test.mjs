import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as core from '../src/index.ts';
import { createTestGame } from '../src/testing.ts';
import { runDemo } from '../scripts/demo.mjs';
import { fixture, players, roleId, evilIds, leader, act, reject, propose, voteAll, playQuest } from './helpers.mjs';

// Independent expectations transcribed from rulebook p2, p3, p5, not computed by the engine.
const tables = [
  [5, 3, 2, [2, 3, 2, 3, 3], [1, 1, 1, 1, 1]],
  [6, 4, 2, [2, 3, 4, 3, 4], [1, 1, 1, 1, 1]],
  [7, 4, 3, [2, 3, 3, 4, 4], [1, 1, 1, 2, 1]],
  [8, 5, 3, [3, 4, 4, 5, 5], [1, 1, 1, 2, 1]],
  [9, 6, 3, [3, 4, 4, 5, 5], [1, 1, 1, 2, 1]],
  [10, 6, 4, [3, 4, 4, 5, 5], [1, 1, 1, 2, 1]],
];

for (const [n, goodCount, evilCount, teamSizes, failThresholds] of tables) {
  test(`${n} players: official team, alignment and failure tables`, () => {
    assert.deepEqual(core.getRules(n), { playerCount: n, goodCount, evilCount, teamSizes, failThresholds });
    const g = fixture(n);
    assert.equal(evilIds(g).length, evilCount);
    assert.equal(g.roles.filter(p => p.role === 'merlin').length, 1);
    assert.equal(g.roles.filter(p => p.role === 'assassin').length, 1);
    assert.equal(g.roles.filter(p => p.role === 'loyal').length, goodCount - 1);
    assert.equal(g.roles.filter(p => p.role === 'minion').length, evilCount - 1);
    assert.equal(g.phase, 'proposal');
    assert.ok(g.leaderIndex >= 0 && g.leaderIndex < n);
  });
  test(`${n} players: three failed quests end immediately`, () => {
    let g = fixture(n);
    for (let i = 0; i < 3; i++) g = playQuest(g, 1);
    assert.equal(g.phase, 'ended');
    assert.deepEqual(g.outcome, { winner: 'evil', reason: 'three_failed_quests' });
    assert.equal(g.quests.length, 3);
    for (const p of g.players) assert.deepEqual(core.getLegalActions(g, p.id), []);
    reject(g, roleId(g, 'assassin'), { type: 'assassinate', targetId: roleId(g, 'merlin') }, 'GAME_ENDED');
  });
  for (const hit of [true, false]) {
    test(`${n} players: three successes then assassination ${hit ? 'hits' : 'misses'}`, () => {
      let g = fixture(n);
      for (let i = 0; i < 3; i++) g = playQuest(g, 0);
      assert.equal(g.phase, 'assassination');
      assert.equal(g.outcome, null, 'good must not win before assassination');
      const assassin = roleId(g, 'assassin');
      assert.equal(core.getLegalActions(g, assassin)[0].type, 'assassinate');
      for (const p of g.players.filter(p => p.id !== assassin)) assert.deepEqual(core.getLegalActions(g, p.id), []);
      g = act(g, assassin, { type: 'assassinate', targetId: roleId(g, hit ? 'merlin' : 'loyal') });
      assert.equal(g.phase, 'ended');
      assert.deepEqual(g.outcome, hit ? { winner: 'evil', reason: 'merlin_assassinated' } : { winner: 'good', reason: 'assassination_missed' });
      reject(g, assassin, { type: 'assassinate', targetId: roleId(g, 'merlin') }, 'GAME_ENDED');
    });
  }
  test(`${n} players: fifth consecutive rejection, with clockwise leader rotation`, () => {
    let g = fixture(n);
    for (let round = 1; round <= 5; round++) {
      const previousLeader = g.leaderIndex;
      g = voteAll(propose(g), 0);
      assert.equal(g.rejectionCount, round);
      assert.equal(g.quests.length, 0);
      assert.equal(g.questNumber, 1);
      if (round < 5) {
        assert.equal(g.phase, 'proposal');
        assert.equal(g.leaderIndex, (previousLeader + 1) % n);
      }
    }
    assert.deepEqual(g.outcome, { winner: 'evil', reason: 'five_rejections' });
  });
  test(`${n} players: fourth quest requires ${n >= 7 ? 'two failures' : 'one failure'}`, () => {
    let g = fixture(n);
    g = playQuest(g, 0); g = playQuest(g, 1); g = playQuest(g, 0);
    assert.equal(g.questNumber, 4);
    const fourth = g;
    g = playQuest(g, 1);
    assert.equal(g.quests[3].succeeded, n >= 7);
    assert.equal(g.phase, n >= 7 ? 'assassination' : 'proposal');
    const two = playQuest(fourth, 2);
    assert.equal(two.quests[3].succeeded, false);
    assert.equal(two.questNumber, 5);
    // The exception is only quest four: one failure on quest five loses it.
    const fifth = playQuest(two, 1);
    assert.equal(fifth.quests[4].succeeded, false);
    assert.deepEqual(fifth.outcome, { winner: 'evil', reason: 'three_failed_quests' });
  });
}

for (const n of [6, 8, 10]) test(`${n} players: tied vote rejects, strict majority passes`, () => {
  const g = fixture(n);
  assert.equal(voteAll(propose(g), n / 2).phase, 'proposal');
  assert.equal(voteAll(propose(g), n / 2 + 1).phase, 'quest');
});

test('rejections reset on approval; completed quests rotate leader and keep consecutive count separate', () => {
  let g = fixture();
  for (let i = 0; i < 4; i++) g = voteAll(propose(g), 0);
  const lastLeader = g.leaderIndex;
  g = playQuest(g, 0);
  assert.equal(g.rejectionCount, 0);
  assert.equal(g.leaderIndex, (lastLeader + 1) % 6);
  for (let i = 0; i < 4; i++) g = voteAll(propose(g), 0);
  assert.equal(g.phase, 'proposal');
  assert.equal(g.rejectionCount, 4);
  assert.equal(g.questNumber, 2);
});

test('leader may include or exclude themselves; no duplicate or unknown seats', () => {
  const g = fixture();
  const others = g.players.filter(p => p.id !== leader(g)).map(p => p.id);
  assert.equal(propose(g, others.slice(0, 2)).phase, 'voting');
  assert.equal(propose(g, [leader(g), others[0]]).phase, 'voting');
  for (const team of [[], [others[0]], others.slice(0, 3), [others[0], others[0]], [others[0], 'outsider']]) {
    reject(g, leader(g), { type: 'propose_team', team }, 'INVALID_TEAM');
  }
});

test('good can only play success; evil can choose either card', () => {
  const g0 = fixture();
  const good = roleId(g0, 'loyal');
  const evil = roleId(g0, 'assassin');
  let g = voteAll(propose(g0, [good, evil]));
  assert.deepEqual(core.getLegalActions(g, good)[0].choices, ['success']);
  assert.deepEqual(core.getLegalActions(g, evil)[0].choices, ['success', 'fail']);
  reject(g, good, { type: 'quest_card', card: 'fail' }, 'INVALID_CARD');
  g = act(g, good, { type: 'quest_card', card: 'success' });
  const succeeds = act(g, evil, { type: 'quest_card', card: 'success' });
  const fails = act(g, evil, { type: 'quest_card', card: 'fail' });
  assert.equal(succeeds.quests[0].succeeded, true);
  assert.equal(fails.quests[0].succeeded, false);
});

test('configuration and player validation rejects unsupported expansions, counts and identities', () => {
  for (const count of [0, 4, 11, 6.1, NaN, Infinity, '6']) assert.throws(() => core.createGame({ playerCount: count }, players(6)), { code: 'INVALID_CONFIG' });
  for (const config of [null, [], {}, { playerCount: 6, roleSet: 'all' }, { playerCount: 6, roles: ['merlin'] }, { playerCount: 6, seed: 42 }]) {
    assert.throws(() => core.createGame(config, players(6)), { code: 'INVALID_CONFIG' });
  }
  for (const input of [null, [], players(5), [...players(5), players(5)[0]], [...players(5), { id: '', name: 'X' }], [...players(5), { id: 'p6', name: '' }], new Array(6)]) {
    assert.throws(() => core.createGame({ playerCount: 6 }, input), { code: 'INVALID_PLAYERS' });
  }
});

test('test seeds reproduce full state; production rejects seeds and uses cryptographic randomness', t => {
  assert.deepEqual(fixture(6, 73), fixture(6, 73));
  assert.notDeepEqual(fixture(6, 73).roles, fixture(6, 74).roles);
  assert.equal('createTestGame' in core, false);
  assert.throws(() => createTestGame({ playerCount: 6 }, players(6), -1));
  t.mock.method(Math, 'random', () => { throw new Error('Predictable random must not be called'); });
  const original = crypto.getRandomValues.bind(crypto);
  let calls = 0;
  t.mock.method(crypto, 'getRandomValues', value => { calls++; return original(value); });
  const g = core.createGame({ playerCount: 6 }, players(6));
  assert.ok(calls >= 6);
  assert.match(g.id, /^[a-f0-9-]{36}$/);
  assert.equal(evilIds(g).length, 2);
  assert.equal(JSON.stringify(g).includes('seed'), false);
});

test('rules and returned views cannot mutate canonical tables or server state', () => {
  const rules = core.getRules(7);
  rules.teamSizes[0] = 100;
  assert.equal(core.getRules(7).teamSizes[0], 2);
  const g = fixture();
  const snapshot = structuredClone(g);
  const view = core.getPlayerView(g, 'p1');
  view.public.players[0].name = 'tampered';
  view.public.events.length = 0;
  view.self.knowledge.knownAlignments.push({playerId:'outsider',alignment:'evil'});
  assert.deepEqual(g, snapshot);
  assert.throws(() => { g.roles[0].role = 'merlin'; }, TypeError);
  assert.throws(() => { g.votes.push({ playerId: 'p1', vote: 'approve' }); }, TypeError);
});

test('script-only legal players finish all counts across ten seeds without privileged input', () => {
  for (const n of [5, 6, 7, 8, 9, 10]) for (let seed = 0; seed < 10; seed++) {
    const result = runDemo(n, seed);
    assert.equal(result.view.phase, 'ended');
    assert.ok(result.steps < 300);
    assert.ok(result.view.outcome);
  }
});
