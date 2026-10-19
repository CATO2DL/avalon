// Public catalogue only. Never store a game/player-to-role assignment here.
const details = {
  merlin: ['梅林', '正义', '看到除莫德雷德以外的邪恶玩家，包括奥伯伦。', '你看到的是阵营信息，不是每名玩家的具体角色。任务成功三次后仍须躲过刺杀。', true],
  percival: ['派西维尔', '正义', '获得梅林候选信息。存在莫甘娜时无法区分两人。', '有莫甘娜时不能区分两人；没有莫甘娜时，只看到梅林一人。', true],
  loyal: ['忠臣', '正义', '没有额外的身份信息。执行任务时只能选择成功。', '根据公开组队、投票与讨论判断；不要把推测当作已知身份。', true],
  morgana: ['莫甘娜', '邪恶', '在派西维尔眼中与梅林不可区分。', '参与邪恶互认（不含奥伯伦），不知道队友的准确角色。', true],
  assassin: ['刺客', '邪恶', '三次任务成功后，拥有一次刺杀梅林的机会。', '参与邪恶互认（不含奥伯伦）。命中梅林则邪恶获胜；误选奥伯伦也算刺杀落空。', true],
  mordred: ['莫德雷德', '邪恶', '身份不会被梅林看见。', '正常参与邪恶互认（不含奥伯伦），不知道队友的准确角色。', true],
  oberon: ['奥伯伦', '邪恶', '不与其他邪恶玩家互认，但仍会被梅林看见。', '没有邪恶队友视野。梅林仍能看到你的邪恶阵营。', true],
  minion: ['普通邪恶爪牙', '邪恶', '知道除奥伯伦之外的邪恶同伴，任务可选择成功或失败。', '知道同伴阵营不代表知道其精确角色；任务结果仍匿名汇总。', true],
};
export const roleAssets = Object.freeze(Object.fromEntries(Object.entries(details).map(([id, [name, alignment, skill, analysis, playable]]) => [id, Object.freeze({
  id, name, alignment, skill, analysis, playable,
  src: `/assets/roles/${id}-640.webp`, srcset: `/assets/roles/${id}-640.webp 640w, /assets/roles/${id}-960.webp 960w`, width: 640, height: 960,
})])));
export const roleAssetFiles = Object.freeze(Object.keys(details).flatMap(id => [640, 960].map(w => `${id}-${w}.webp`)));
