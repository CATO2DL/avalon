import { alignmentOf, getRules } from './config.ts';
import { RuleError } from './errors.ts';
import { constructGame, deepFreeze, secureIndex } from './internal.ts';
import type {
  Action, ApplyResult, ErrorCode, Game, GameConfig, GameState, LegalAction,
  Outcome, Player, PlayerKnowledge, PlayerView, PublicEventPayload, PublicView, Role,
} from './types.ts';

export function createGame(config: GameConfig, players: readonly Player[]): Game {
  return constructGame(config, players, secureIndex, globalThis.crypto.randomUUID());
}

function roleFor(game: Game, playerId: string): Role {
  const player = game.roles.find(p => p.playerId === playerId);
  if (!player) throw new RuleError('UNKNOWN_PLAYER');
  return player.role;
}

/** The only private knowledge projection; both actions and all clients consume it. */
function knowledgeFor(game: Game, playerId: string): PlayerKnowledge {
  const role = roleFor(game,playerId);
  const knownAlignments: PlayerKnowledge['knownAlignments'] = [];
  for (const p of game.players) {
    if(p.id === playerId) continue;
    const other = roleFor(game,p.id);
    const sees = role === 'merlin' ? alignmentOf(other) === 'evil' && other !== 'mordred'
      : alignmentOf(role) === 'evil' && role !== 'oberon' && alignmentOf(other) === 'evil' && other !== 'oberon';
    if(sees) knownAlignments.push({playerId:p.id,alignment:'evil'});
  }
  return { knownAlignments, roleCandidates: role === 'percival' ? [{
    kind:'merlin', playerIds:game.players.filter(p=>['merlin','morgana'].includes(roleFor(game,p.id))).map(p=>p.id),
    possibleRoles:game.config.roles.includes('morgana') ? ['merlin','morgana'] : ['merlin'],
  }] : [] };
}
function assassinationTargets(game: Game, playerId: string): string[] {
  // D-28: all evil teammates, including Oberon, are revealed at this stage.
  return game.players.filter(p=>p.id!==playerId && alignmentOf(roleFor(game,p.id)) === 'good').map(p=>p.id);
}

export function getPublicView(game: Game): PublicView {
  const rules = getRules(game.config.playerCount);
  // Explicit allowlist. Never spread the server-only GameState into a view.
  return structuredClone({
    gameId: game.id, version: game.version, config: game.config, players: game.players,
    phase: game.phase, leaderId: game.players[game.leaderIndex]!.id,
    questNumber: game.questNumber, teamSize: rules.teamSizes[game.questNumber - 1]!,
    failThreshold: rules.failThresholds[game.questNumber - 1]!, team: game.team,
    rejectionCount: game.rejectionCount,
    submissions: { votes: game.votes.length, questCards: game.questCards.length },
    submissionPlayers: {votes:game.players.filter(p=>game.votes.some(v=>v.playerId===p.id)).map(p=>p.id),quests:game.players.filter(p=>game.questCards.some(c=>c.playerId===p.id)).map(p=>p.id)},
    score: { good: game.quests.filter(q => q.succeeded).length, evil: game.quests.filter(q => !q.succeeded).length },
    quests: game.quests, events: game.events, outcome: game.outcome,
    ...(game.phase === 'ended' && game.outcome ? {
      revealedRoles: game.players.map(p => ({ playerId: p.id, role: roleFor(game, p.id), alignment: alignmentOf(roleFor(game, p.id)) })),
    } : {}),
  }) as PublicView;
}

export function getLegalActions(game: Game, playerId: string): LegalAction[] {
  const role = roleFor(game, playerId);
  const hint = { gameId: game.id, expectedVersion: game.version };
  switch (game.phase) {
    case 'proposal':
      return game.players[game.leaderIndex]!.id === playerId
        ? [{ ...hint, type: 'propose_team', teamSize: getRules(game.config.playerCount).teamSizes[game.questNumber - 1]!, candidateIds: game.players.map(p => p.id) }] : [];
    case 'voting':
      return game.votes.some(v => v.playerId === playerId) ? []
        : [{ ...hint, type: 'vote', choices: ['approve', 'reject'] }];
    case 'quest':
      return !game.team.includes(playerId) || game.questCards.some(c => c.playerId === playerId) ? []
        : [{ ...hint, type: 'quest_card', choices: alignmentOf(role) === 'good' ? ['success'] : ['success', 'fail'] }];
    case 'assassination':
      // Stage-revealed evil teammates cannot be selected.
      return role !== 'assassin' ? [] : [{ ...hint, type:'assassinate', candidateIds:assassinationTargets(game,playerId) }];
    case 'ended': return [];
  }
}

export function getPlayerView(game: Game, playerId: string): PlayerView {
  const role = roleFor(game, playerId);
  const alignment = alignmentOf(role);
  const knowledge = knowledgeFor(game,playerId);
  return {
    public: getPublicView(game),
    self: {
      playerId, role, alignment,
      knowledge,
      ...(game.phase === 'assassination' ? { assassinationRoles: game.players
        .filter(p => alignment === 'good' || (p.id !== playerId && alignmentOf(roleFor(game,p.id)) === 'evil'))
        .map(p => ({ playerId: p.id, role: roleFor(game,p.id), alignment: alignmentOf(roleFor(game,p.id)) })) } : {}),
      ownVote: game.votes.find(v => v.playerId === playerId)?.vote ?? null,
      ownQuestCard: game.questCards.find(c => c.playerId === playerId)?.card ?? null,
    },
    legalActions: getLegalActions(game, playerId),
  };
}

function isAction(value: unknown): value is Action {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const a = value as Record<string, unknown>;
  if (typeof a.gameId !== 'string' || typeof a.requestId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(a.requestId) || !Number.isSafeInteger(a.expectedVersion) ||
      (a.expectedVersion as number) < 0) return false;
  let payloadKey: string;
  switch (a.type) {
    case 'propose_team':
      if (!Array.isArray(a.team) || !a.team.every(id => typeof id === 'string')) return false;
      payloadKey = 'team'; break;
    case 'vote':
      if (a.vote !== 'approve' && a.vote !== 'reject') return false;
      payloadKey = 'vote'; break;
    case 'quest_card':
      if (a.card !== 'success' && a.card !== 'fail') return false;
      payloadKey = 'card'; break;
    case 'assassinate':
      if (typeof a.targetId !== 'string') return false;
      payloadKey = 'targetId'; break;
    default: return false;
  }
  return Object.keys(a).every(k => ['type', 'gameId', 'requestId', 'expectedVersion', payloadKey].includes(k));
}

function validateAction(game: Game, playerId: string, a: Action): ErrorCode | null {
  const role = roleFor(game, playerId);
  if (game.phase === 'ended') return 'GAME_ENDED';
  switch (a.type) {
    case 'propose_team': {
      if (game.phase !== 'proposal') return 'WRONG_PHASE';
      if (game.players[game.leaderIndex]!.id !== playerId) return 'NOT_ALLOWED';
      const size = getRules(game.config.playerCount).teamSizes[game.questNumber - 1];
      return a.team.length !== size || new Set(a.team).size !== size ||
        a.team.some(id => !game.players.some(p => p.id === id)) ? 'INVALID_TEAM' : null;
    }
    case 'vote':
      if (game.phase !== 'voting') return 'WRONG_PHASE';
      return game.votes.some(v => v.playerId === playerId) ? 'ALREADY_SUBMITTED' : null;
    case 'quest_card':
      if (game.phase !== 'quest') return 'WRONG_PHASE';
      if (!game.team.includes(playerId)) return 'NOT_ALLOWED';
      if (game.questCards.some(c => c.playerId === playerId)) return 'ALREADY_SUBMITTED';
      return alignmentOf(role) === 'good' && a.card === 'fail' ? 'INVALID_CARD' : null;
    case 'assassinate':
      if (game.phase !== 'assassination') return 'WRONG_PHASE';
      if (role !== 'assassin') return 'NOT_ALLOWED';
      return !assassinationTargets(game,playerId).includes(a.targetId)
        ? 'INVALID_TARGET' : null;
  }
}

function emit(game: GameState, event: PublicEventPayload): void {
  game.events.push({ ...event, sequence: game.events.length, version: game.version });
}

function finish(game: GameState, outcome: Outcome): void {
  game.phase = 'ended';
  game.outcome = outcome;
  emit(game, { type: 'game_ended', ...outcome });
}

function nextLeader(game: GameState): void {
  game.leaderIndex = (game.leaderIndex + 1) % game.players.length;
}

/** Trusted server reducer. Caller must authenticate playerId and atomically store success.game. */
export function applyAction(game: Game, playerId: string, action: unknown): ApplyResult {
  if (!game.players.some(p => p.id === playerId)) return { ok: false, error: 'UNKNOWN_PLAYER' };
  if (!isAction(action)) return { ok: false, error: 'INVALID_ACTION' };
  if (action.gameId !== game.id) return { ok: false, error: 'WRONG_GAME' };
  if (game.processedRequests.some(r => r.playerId === playerId && r.requestId === action.requestId)) {
    return { ok: false, error: 'DUPLICATE_REQUEST' };
  }
  if (action.expectedVersion !== game.version) return { ok: false, error: 'STALE_VERSION' };
  const error = validateAction(game, playerId, action);
  if (error) return { ok: false, error };
  // Validation is complete before any copy or transition. Caller state never mutates.
  const next = structuredClone(game) as GameState;
  next.version++;
  next.processedRequests.push({ playerId, requestId: action.requestId });
  switch (action.type) {
    case 'propose_team':
      next.team = next.players.filter(p => action.team.includes(p.id)).map(p => p.id);
      next.phase = 'voting';
      emit(next, { type: 'team_proposed', questNumber: next.questNumber,
        leaderId: next.players[next.leaderIndex]!.id, team: [...next.team] });
      break;
    case 'vote': {
      next.votes.push({ playerId, vote: action.vote });
      if (next.votes.length < next.players.length) break;
      const approved = next.votes.filter(v => v.vote === 'approve').length > next.players.length / 2;
      // Publish only the completed vote, ordered by seat, not submission time.
      emit(next, { type: 'team_vote_resolved', questNumber: next.questNumber, approved,
        votes: next.players.map(p => ({ ...next.votes.find(v => v.playerId === p.id)! })) });
      next.votes = [];
      if (approved) {
        next.phase = 'quest';
        if(next.config.rejectionMode!=='cumulative')next.rejectionCount = 0;
      } else {
        next.rejectionCount++;
        if (next.rejectionCount === 5) finish(next, { winner: 'evil', reason: 'five_rejections' });
        else { nextLeader(next); next.team = []; next.phase = 'proposal'; }
      }
      break;
    }
    case 'quest_card': {
      next.questCards.push({ playerId, card: action.card });
      if (next.questCards.length < next.team.length) break;
      const failCount = next.questCards.filter(c => c.card === 'fail').length;
      const result = {
        questNumber: next.questNumber, team: [...next.team], failCount,
        successCount: next.team.length - failCount,
        succeeded: failCount < getRules(next.config.playerCount).failThresholds[next.questNumber - 1]!,
      };
      next.quests.push(result);
      emit(next, { type: 'quest_resolved', ...result });
      // Discard attribution. No public event, replay or ordinary history contains it.
      next.questCards = [];
      if (next.quests.filter(q => !q.succeeded).length === 3) {
        finish(next, { winner: 'evil', reason: 'three_failed_quests' });
      } else if (next.quests.filter(q => q.succeeded).length === 3) {
        next.phase = 'assassination';
        emit(next, { type: 'assassination_started' });
      } else {
        next.questNumber++; nextLeader(next); next.team = []; next.phase = 'proposal';
      }
      break;
    }
    case 'assassinate':
      emit(next, { type: 'assassination_resolved', targetId: action.targetId });
      finish(next, roleFor(next, action.targetId) === 'merlin'
        ? { winner: 'evil', reason: 'merlin_assassinated' }
        : { winner: 'good', reason: 'assassination_missed' });
      break;
  }
  return { ok: true, game: deepFreeze(next) };
}
