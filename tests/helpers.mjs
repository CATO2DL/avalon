import assert from 'node:assert/strict';
import { applyAction, alignmentOf, getPublicView } from '../src/index.ts';
import { createTestGame } from '../src/testing.ts';

let request = 0;
export const players = n => Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `玩家 ${i + 1}` }));
export const fixture = (n = 6, seed = 42) => createTestGame({ playerCount: n }, players(n), seed);
export const roleId = (g, role) => g.roles.find(p => p.role === role).playerId;
export const evilIds = g => g.roles.filter(p => alignmentOf(p.role) === 'evil').map(p => p.playerId);
export const leader = g => g.players[g.leaderIndex].id;
export const action = (g, payload, overrides = {}) => ({ gameId: g.id, expectedVersion: g.version, requestId: `req-${++request}`, ...payload, ...overrides });

export function act(g, playerId, payload, overrides) {
  const before = JSON.stringify(g);
  const result = applyAction(g, playerId, action(g, payload, overrides));
  assert.equal(result.ok, true, result.error);
  assert.equal(JSON.stringify(g), before, 'successful reducer mutated input');
  assert.equal(result.game.version, g.version + 1);
  return result.game;
}

export function reject(g, playerId, payload, error, overrides) {
  const before = structuredClone(g);
  const publicBefore = getPublicView(g);
  const result = applyAction(g, playerId, action(g, payload, overrides));
  assert.deepEqual(result, { ok: false, error });
  assert.deepEqual(g, before, 'rejection mutated server state');
  assert.deepEqual(getPublicView(g), publicBefore, 'rejection changed public state');
}

export function propose(g, team = g.players.slice(0, getPublicView(g).teamSize).map(p => p.id)) {
  return act(g, leader(g), { type: 'propose_team', team });
}

export function voteAll(g, approvals = g.players.length) {
  const ids = g.players.map(p => p.id);
  for (let i = 0; i < ids.length; i++) g = act(g, ids[i], { type: 'vote', vote: i < approvals ? 'approve' : 'reject' });
  return g;
}

// Omniscient fixture steering is used only to select a specific rule boundary in tests.
export function playQuest(g, failCount = 0) {
  const failPlayers = evilIds(g).slice(0, failCount);
  assert.equal(failPlayers.length, failCount);
  const team = [...failPlayers, ...g.players.map(p => p.id).filter(id => !failPlayers.includes(id))].slice(0, getPublicView(g).teamSize);
  g = voteAll(propose(g, team));
  assert.equal(g.phase, 'quest');
  for (const id of team) g = act(g, id, { type: 'quest_card', card: failPlayers.includes(id) ? 'fail' : 'success' });
  return g;
}
