export type PlayerCount = 5 | 6 | 7 | 8 | 9 | 10;
export type Alignment = 'good' | 'evil';
export type Role = 'merlin' | 'percival' | 'loyal' | 'morgana' | 'assassin' | 'mordred' | 'oberon' | 'minion';
export type Phase = 'proposal' | 'voting' | 'quest' | 'assassination' | 'ended';
export type Vote = 'approve' | 'reject';
export type QuestCard = 'success' | 'fail';
export type FiveNumbers = readonly [number, number, number, number, number];
export interface Player { id: string; name: string }
export interface GameConfig { playerCount: PlayerCount; roleSet?: 'base' | 'recommended' | 'custom'; roles?: readonly Role[] }
export interface ResolvedConfig { playerCount: PlayerCount; roleSet: 'base' | 'recommended' | 'custom'; roles: Role[] }
export interface PlayerKnowledge {
  knownAlignments: { playerId: string; alignment: Alignment }[];
  roleCandidates: { kind: 'merlin'; playerIds: string[]; possibleRoles: ('merlin' | 'morgana')[] }[];
}
export interface RulesConfig {
  playerCount: PlayerCount;
  goodCount: number;
  evilCount: number;
  teamSizes: FiveNumbers;
  failThresholds: FiveNumbers;
}
export interface RoleAssignment { playerId: string; role: Role }
export interface Ballot { playerId: string; vote: Vote }
export interface QuestSubmission { playerId: string; card: QuestCard }
export interface QuestResult {
  questNumber: number;
  team: string[];
  failCount: number;
  successCount: number;
  succeeded: boolean;
}
export interface Outcome {
  winner: Alignment;
  reason: 'three_failed_quests' | 'five_rejections' | 'merlin_assassinated' | 'assassination_missed';
}
export type PublicEventPayload =
  | { type: 'game_created'; leaderId: string }
  | { type: 'team_proposed'; questNumber: number; leaderId: string; team: string[] }
  | { type: 'team_vote_resolved'; questNumber: number; votes: Ballot[]; approved: boolean }
  | ({ type: 'quest_resolved' } & QuestResult)
  | { type: 'assassination_started' }
  | { type: 'assassination_resolved'; targetId: string }
  | ({ type: 'game_ended' } & Outcome);
export type PublicEvent = PublicEventPayload & { sequence: number; version: number };

/** SERVER ONLY. Never serialize this object to a player, host, public screen or model. */
export interface GameState {
  id: string;
  config: ResolvedConfig;
  players: Player[];
  roles: RoleAssignment[];
  version: number;
  phase: Phase;
  leaderIndex: number;
  questNumber: number;
  team: string[];
  rejectionCount: number;
  votes: Ballot[];
  questCards: QuestSubmission[];
  quests: QuestResult[];
  events: PublicEvent[];
  processedRequests: { playerId: string; requestId: string }[];
  outcome: Outcome | null;
}
export type DeepReadonly<T> = T extends object ? { readonly [P in keyof T]: DeepReadonly<T[P]> } : T;
export type Game = DeepReadonly<GameState>;

export type ActionPayload =
  | { type: 'propose_team'; team: string[] }
  | { type: 'vote'; vote: Vote }
  | { type: 'quest_card'; card: QuestCard }
  | { type: 'assassinate'; targetId: string };
export interface ActionEnvelope { gameId: string; requestId: string; expectedVersion: number }
export type Action = ActionPayload & ActionEnvelope;
export type LegalAction = ActionEnvelopeHint & (
  | { type: 'propose_team'; teamSize: number; candidateIds: string[] }
  | { type: 'vote'; choices: Vote[] }
  | { type: 'quest_card'; choices: QuestCard[] }
  | { type: 'assassinate'; candidateIds: string[] }
);
export interface ActionEnvelopeHint { gameId: string; expectedVersion: number }
export type ErrorCode =
  | 'INVALID_CONFIG' | 'INVALID_PLAYERS' | 'UNKNOWN_PLAYER' | 'INVALID_ACTION'
  | 'WRONG_GAME' | 'DUPLICATE_REQUEST' | 'STALE_VERSION' | 'GAME_ENDED'
  | 'WRONG_PHASE' | 'NOT_ALLOWED' | 'INVALID_TEAM' | 'ALREADY_SUBMITTED'
  | 'INVALID_CARD' | 'INVALID_TARGET';
export type ApplyResult = { ok: true; game: Game } | { ok: false; error: ErrorCode };

export interface PublicView {
  /** Published only after a terminal outcome; never contains individual quest cards. */
  revealedRoles?: (RoleAssignment & { alignment: Alignment })[];
  gameId: string;
  version: number;
  config: ResolvedConfig;
  players: Player[];
  phase: Phase;
  leaderId: string;
  questNumber: number;
  teamSize: number;
  failThreshold: number;
  team: string[];
  rejectionCount: number;
  submissions: { votes: number; questCards: number };
  score: { good: number; evil: number };
  quests: QuestResult[];
  events: PublicEvent[];
  outcome: Outcome | null;
}
export interface PlayerView {
  public: PublicView;
  self: {
    playerId: string;
    role: Role;
    alignment: Alignment;
    knowledge: PlayerKnowledge;
    /** Product rule: private, stage-limited reveals; never part of public events. */
    assassinationRoles?: { playerId: string; role: Role; alignment: Alignment }[];
    ownVote: Vote | null;
    ownQuestCard: QuestCard | null;
  };
  legalActions: LegalAction[];
}
