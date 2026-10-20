import type { Alignment, ResolvedConfig, PlayerCount, Role, RulesConfig } from './types.ts';
import { RuleError } from './errors.ts';

// Original English rulebook: setup p2, team sizes p3, fourth-quest exception p5.
const RULES: Record<PlayerCount, RulesConfig> = {
  5: { playerCount: 5, goodCount: 3, evilCount: 2, teamSizes: [2, 3, 2, 3, 3], failThresholds: [1, 1, 1, 1, 1] },
  6: { playerCount: 6, goodCount: 4, evilCount: 2, teamSizes: [2, 3, 4, 3, 4], failThresholds: [1, 1, 1, 1, 1] },
  7: { playerCount: 7, goodCount: 4, evilCount: 3, teamSizes: [2, 3, 3, 4, 4], failThresholds: [1, 1, 1, 2, 1] },
  8: { playerCount: 8, goodCount: 5, evilCount: 3, teamSizes: [3, 4, 4, 5, 5], failThresholds: [1, 1, 1, 2, 1] },
  9: { playerCount: 9, goodCount: 6, evilCount: 3, teamSizes: [3, 4, 4, 5, 5], failThresholds: [1, 1, 1, 2, 1] },
  10: { playerCount: 10, goodCount: 6, evilCount: 4, teamSizes: [3, 4, 4, 5, 5], failThresholds: [1, 1, 1, 2, 1] },
};

export function getRules(playerCount: number): RulesConfig {
  if (!Number.isInteger(playerCount) || playerCount < 5 || playerCount > 10) {
    throw new RuleError('INVALID_CONFIG');
  }
  // Caller mutation must not alter the canonical tables used by the reducer.
  return structuredClone(RULES[playerCount as PlayerCount]);
}

export const ROLE_ORDER: readonly Role[] = Object.freeze(['merlin','percival','loyal','morgana','assassin','mordred','oberon','minion']);
const evilRoles: readonly Role[] = ['morgana','assassin','mordred','oberon','minion'];
export function alignmentOf(role: Role): Alignment {
  if (!ROLE_ORDER.includes(role)) throw new RuleError('INVALID_CONFIG');
  return evilRoles.includes(role) ? 'evil' : 'good';
}
export function validateConfig(value: unknown): ResolvedConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RuleError('INVALID_CONFIG');
  const c = value as Record<string, unknown>;
  if (Object.keys(c).some(k => !['playerCount','roleSet','roles','rejectionMode'].includes(k)) || typeof c.playerCount !== 'number') throw new RuleError('INVALID_CONFIG');
  if(c.rejectionMode!==undefined&&!['consecutive','cumulative'].includes(c.rejectionMode as string))throw new RuleError('INVALID_CONFIG');
  const r = getRules(c.playerCount);
  const roleSet = c.roleSet === undefined ? (c.roles === undefined ? 'base' : 'custom') : c.roleSet;
  if (typeof roleSet !== 'string' || !['base','recommended','custom'].includes(roleSet)) throw new RuleError('INVALID_CONFIG');
  const preset = roleSet === 'base' ? getBaseRoles(r.playerCount) : roleSet === 'recommended' ? getRecommendedRoles(r.playerCount) : undefined;
  const roles = c.roles === undefined ? preset : c.roles;
  if (!Array.isArray(roles) || roles.length !== r.playerCount || Array.from(roles).some(x => !ROLE_ORDER.includes(x))) throw new RuleError('INVALID_CONFIG');
  const deck = roles as Role[];
  if (preset && ROLE_ORDER.some(x => deck.filter(y=>y===x).length !== preset.filter(y=>y===x).length)) throw new RuleError('INVALID_CONFIG');
  if (deck.filter(x => alignmentOf(x) === 'good').length !== r.goodCount ||
      deck.filter(x => x === 'merlin').length !== 1 || deck.filter(x => x === 'assassin').length !== 1 ||
      ROLE_ORDER.filter(x => x !== 'loyal' && x !== 'minion').some(x => deck.filter(y => y === x).length > 1)) throw new RuleError('INVALID_CONFIG');
  // Canonical public deck order never mirrors the secret assignment/shuffle.
  return { playerCount:r.playerCount, roleSet:roleSet as ResolvedConfig['roleSet'], roles: [...deck].sort((a,b)=>ROLE_ORDER.indexOf(a)-ROLE_ORDER.indexOf(b)), ...(c.rejectionMode==='cumulative'?{rejectionMode:'cumulative' as const}:{}) };
}

/** Build from selected special roles, filling ordinary roles. Merlin/Assassin are mandatory in this product mode. */
export function buildRoleConfig(playerCount: number, specials: readonly Role[]): ResolvedConfig {
  const r = getRules(playerCount);
  if (!Array.isArray(specials) || specials.length > 6 || new Set(specials).size !== specials.length ||
      Array.from(specials).some(x => !ROLE_ORDER.includes(x) || x === 'loyal' || x === 'minion')) throw new RuleError('INVALID_CONFIG');
  const good = specials.filter(x => alignmentOf(x) === 'good').length;
  const evil = specials.length-good;
  if (good > r.goodCount || evil > r.evilCount) throw new RuleError('INVALID_CONFIG');
  return validateConfig({playerCount, roleSet:'custom', roles:[...specials,...Array<Role>(r.goodCount-good).fill('loyal'),...Array<Role>(r.evilCount-evil).fill('minion')]});
}

export function getRecommendedRoles(playerCount: number): Role[] {
  const r = getRules(playerCount);
  const evil: Role[] = ['morgana','assassin'];
  if (playerCount === 7 || playerCount === 10) evil.push('oberon');
  if (playerCount >= 8) evil.push('mordred');
  return ['merlin','percival',...Array<Role>(r.goodCount-2).fill('loyal'),...evil];
}
export function getConfigNotes(config: ResolvedConfig): string[] {
  const roles = config.roles, notes: string[] = [];
  if (roles.includes('percival') && !roles.includes('morgana')) notes.push('没有莫甘娜：派西维尔只会看到梅林一人。');
  if (config.playerCount === 5 && roles.includes('percival') && !roles.includes('morgana') && !roles.includes('mordred')) notes.push('原版五人平衡建议：派西维尔搭配莫甘娜或莫德雷德；当前组合仍允许开局。');
  if (roles.includes('oberon')) notes.push('奥伯伦不参与邪恶互认，但梅林能看到他。');
  return notes;
}

export function getBaseRoles(playerCount: number): Role[] {
  const r = getRules(playerCount);
  return ['merlin', ...Array<Role>(r.goodCount - 1).fill('loyal'),
    'assassin', ...Array<Role>(r.evilCount - 1).fill('minion')];
}
