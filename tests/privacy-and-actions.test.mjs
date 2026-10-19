import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyAction, getPlayerView, getPublicView, getLegalActions } from '../src/index.ts';
import { fixture, roleId, evilIds, leader, action, act, reject, propose, voteAll, playQuest } from './helpers.mjs';

test('base player knowledge follows role, not room ownership; public state has no secret fields', () => {
  for (const n of [5, 6, 7, 8, 9, 10]) {
    const g = fixture(n);
    for (const p of g.players) {
      const view = getPlayerView(g, p.id);
      const actual = g.roles.find(r => r.playerId === p.id).role;
      assert.equal(view.self.role, actual);
      assert.deepEqual(view.self.knowledge.knownAlignments.map(x=>x.playerId), actual === 'loyal' ? [] : evilIds(g).filter(id => id !== p.id));
      assert.deepEqual(view.public, getPublicView(g));
      assert.deepEqual(Object.keys(view).sort(), ['legalActions', 'public', 'self']);
      assert.deepEqual(Object.keys(view.self).sort(), ['alignment', 'knowledge', 'ownQuestCard', 'ownVote', 'playerId', 'role']);
    }
    const pub = getPublicView(g);
    for (const field of ['roles', 'votes', 'questCards', 'processedRequests', 'seed']) assert.equal(Object.hasOwn(pub, field), false);
    assert.deepEqual(pub.config.roles.slice().sort(),g.roles.map(x=>x.role).sort());
    assert.equal(JSON.stringify(pub.events).includes('assassin'), false);
    assert.throws(() => getPlayerView(g, 'outsider'), { code: 'UNKNOWN_PLAYER' });
    assert.throws(() => getLegalActions(g, 'outsider'), { code: 'UNKNOWN_PLAYER' });
  }
});

test('uncollected votes remain hidden, even when current votes already imply a majority', () => {
  let g = propose(fixture());
  const voter = g.players[0].id;
  const observer = g.players[1].id;
  const approve = act(g, voter, { type: 'vote', vote: 'approve' });
  const rejectVote = act(g, voter, { type: 'vote', vote: 'reject' });
  assert.deepEqual(getPublicView(approve), getPublicView(rejectVote));
  assert.deepEqual(getPlayerView(approve, observer), getPlayerView(rejectVote, observer));
  assert.equal(getPlayerView(approve, voter).self.ownVote, 'approve');
  assert.equal(getPlayerView(rejectVote, voter).self.ownVote, 'reject');
  g = approve;
  for (const p of g.players.slice(1, -1)) g = act(g, p.id, { type: 'vote', vote: 'approve' });
  assert.equal(g.phase, 'voting');
  assert.equal(g.events.filter(e => e.type === 'team_vote_resolved').length, 0);
  assert.equal(getPublicView(g).submissions.votes, 5);
  assert.deepEqual(getLegalActions(g, voter), []);
  g = act(g, g.players.at(-1).id, { type: 'vote', vote: 'reject' });
  assert.equal(g.phase, 'quest');
  const event = getPublicView(g).events.find(e => e.type === 'team_vote_resolved');
  assert.equal(event.votes.length, 6);
  assert.deepEqual(event.votes.at(-1), { playerId: g.players.at(-1).id, vote: 'reject' });
  assert.deepEqual(g.votes, []);
});

test('uncollected quest cards do not reveal values or settle early; history is anonymous', () => {
  const g0 = fixture();
  const evil = roleId(g0, 'assassin');
  const good = roleId(g0, 'loyal');
  const waiting = voteAll(propose(g0, [evil, good]));
  const success = act(waiting, evil, { type: 'quest_card', card: 'success' });
  const fail = act(waiting, evil, { type: 'quest_card', card: 'fail' });
  assert.deepEqual(getPublicView(success), getPublicView(fail));
  assert.deepEqual(getPlayerView(success, good), getPlayerView(fail, good));
  assert.equal(getPlayerView(fail, evil).self.ownQuestCard, 'fail');
  assert.equal(fail.phase, 'quest');
  assert.equal(fail.quests.length, 0);
  assert.equal(fail.events.some(e => e.type === 'quest_resolved'), false);
  assert.equal(fail.outcome, null);
  const resolved = act(fail, good, { type: 'quest_card', card: 'success' });
  const event = getPublicView(resolved).events.find(e => e.type === 'quest_resolved');
  assert.equal(event.failCount, 1);
  assert.deepEqual(Object.keys(event).sort(), ['failCount', 'questNumber', 'sequence', 'succeeded', 'successCount', 'team', 'type', 'version']);
  assert.deepEqual(resolved.questCards, []);
  assert.equal(event.playerId, undefined);
  assert.equal(event.card, undefined);
});

test('pending failures do not trigger the third failed quest until the entire team submits', () => {
  let g = playQuest(playQuest(fixture(5), 1), 1);
  const evil = evilIds(g)[0];
  const good = roleId(g, 'loyal');
  g = voteAll(propose(g, [evil, good]));
  g = act(g, evil, { type: 'quest_card', card: 'fail' });
  assert.equal(g.phase, 'quest');
  assert.equal(g.outcome, null);
  assert.deepEqual(getPublicView(g).score, { good: 0, evil: 2 });
  g = act(g, good, { type: 'quest_card', card: 'success' });
  assert.equal(g.outcome.reason, 'three_failed_quests');
});

test('quest aggregation is invariant to submission order and failure attribution', () => {
  const start = fixture();
  const [a, b] = evilIds(start);
  const waiting = voteAll(propose(start, [a, b]));
  let g1 = act(waiting, a, { type: 'quest_card', card: 'fail' });
  g1 = act(g1, b, { type: 'quest_card', card: 'success' });
  let g2 = act(waiting, b, { type: 'quest_card', card: 'fail' });
  g2 = act(g2, a, { type: 'quest_card', card: 'success' });
  assert.deepEqual(getPublicView(g1), getPublicView(g2));
});

test('wrong phase, unauthorized, malformed and unknown-player actions leave state unchanged', () => {
  const initial = fixture();
  const nonleader = initial.players.find(p => p.id !== leader(initial)).id;
  reject(initial, nonleader, { type: 'propose_team', team: ['p1', 'p2'] }, 'NOT_ALLOWED');
  reject(initial, 'outsider', { type: 'vote', vote: 'approve' }, 'UNKNOWN_PLAYER');
  reject(initial, 'p1', { type: 'vote', vote: 'approve' }, 'WRONG_PHASE');
  reject(initial, roleId(initial, 'assassin'), { type: 'assassinate', targetId: roleId(initial, 'merlin') }, 'WRONG_PHASE');
  let g = propose(initial);
  reject(g, leader(g), { type: 'propose_team', team: ['p1', 'p2'] }, 'WRONG_PHASE');
  reject(g, 'p1', { type: 'quest_card', card: 'success' }, 'WRONG_PHASE');
  g = voteAll(g);
  const outsider = g.players.find(p => !g.team.includes(p.id)).id;
  reject(g, outsider, { type: 'quest_card', card: 'success' }, 'NOT_ALLOWED');
  reject(g, g.team[0], { type: 'vote', vote: 'approve' }, 'WRONG_PHASE');
  for (const invalid of [null, [], {}, { type: 'vote', vote: 'maybe' }, { type: 'quest_card', card: 'maybe' }, { type: 'delete_game' }, { type: 'propose_team', team: [1, 2] }]) {
    const before = structuredClone(g);
    const result = applyAction(g, 'p1', invalid === null ? null : action(g, invalid));
    assert.deepEqual(result, { ok: false, error: 'INVALID_ACTION' });
    assert.deepEqual(g, before);
  }
  reject(g, 'p1', { type: 'vote', vote: 'approve', administrator: true }, 'INVALID_ACTION');
});

test('request replay, changed-payload replay, double submission and stale actions are rejected atomically', () => {
  const g0 = propose(fixture());
  const request = action(g0, { type: 'vote', vote: 'approve' }, { requestId: 'once' });
  const first = applyAction(g0, 'p1', request);
  assert.equal(first.ok, true);
  const g = first.game;
  const before = structuredClone(g);
  assert.deepEqual(applyAction(g, 'p1', request), { ok: false, error: 'DUPLICATE_REQUEST' });
  reject(g, 'p1', { type: 'vote', vote: 'reject' }, 'DUPLICATE_REQUEST', { requestId: 'once' });
  reject(g, 'p1', { type: 'vote', vote: 'approve' }, 'ALREADY_SUBMITTED');
  reject(g, 'p2', { type: 'vote', vote: 'approve' }, 'STALE_VERSION', { expectedVersion: g0.version });
  reject(g, 'p2', { type: 'vote', vote: 'approve' }, 'STALE_VERSION', { expectedVersion: g.version + 1 });
  reject(g, 'p2', { type: 'vote', vote: 'approve' }, 'WRONG_GAME', { gameId: 'another-game' });
  assert.deepEqual(g, before);
  // Request identifiers are scoped to the authenticated player; refreshing enables a valid submit.
  const refreshed = act(g, 'p2', { type: 'vote', vote: 'approve' }, { requestId: 'once' });
  assert.equal(refreshed.votes.length, 2);
});

test('same player cannot submit quest twice, even with a fresh request and version', () => {
  let g = voteAll(propose(fixture()));
  const first = g.team[0];
  g = act(g, first, { type: 'quest_card', card: 'success' });
  reject(g, first, { type: 'quest_card', card: 'success' }, 'ALREADY_SUBMITTED');
  assert.deepEqual(getLegalActions(g, first), []);
});

test('assassin is the sole actor; invalid target does not consume their one attempt', () => {
  let g = fixture();
  for (let i = 0; i < 3; i++) g = playQuest(g, 0);
  const assassin = roleId(g, 'assassin');
  reject(g, roleId(g, 'minion'), { type: 'assassinate', targetId: roleId(g, 'merlin') }, 'NOT_ALLOWED');
  for (const targetId of ['outsider', ...evilIds(g)]) reject(g, assassin, { type: 'assassinate', targetId }, 'INVALID_TARGET');
  g = act(g, assassin, { type: 'assassinate', targetId: roleId(g, 'loyal') });
  assert.equal(g.outcome.winner, 'good');
  assert.equal(Object.hasOwn(getPublicView(g), 'roles'), false, 'terminal state is not a full secret dump');
});

test('completed vote is published in seat order; history versions and sequence remain consistent', () => {
  const g0 = propose(fixture());
  let forward = g0, reverse = g0;
  for (const p of g0.players) forward = act(forward, p.id, { type: 'vote', vote: 'approve' });
  for (const p of [...g0.players].reverse()) reverse = act(reverse, p.id, { type: 'vote', vote: 'approve' });
  assert.deepEqual(getPublicView(forward), getPublicView(reverse));
  let g = fixture();
  for (let i = 0; i < 3; i++) g = playQuest(g, 0);
  g = act(g, roleId(g, 'assassin'), { type: 'assassinate', targetId: roleId(g, 'loyal') });
  assert.deepEqual(g.events.map(e => e.sequence), g.events.map((_, i) => i));
  for (let i = 1; i < g.events.length; i++) assert.ok(g.events[i].version >= g.events[i - 1].version);
  assert.equal(g.events.at(-1).version, g.version);
});

test('special player identifiers cannot access object prototype entries', () => {
  // IDs are stored in arrays, so prototype-like names do not grant votes or roles.
  const g = fixture();
  reject(g, '__proto__', { type: 'vote', vote: 'approve' }, 'UNKNOWN_PLAYER');
  reject(g, 'constructor', { type: 'vote', vote: 'approve' }, 'UNKNOWN_PLAYER');
});
