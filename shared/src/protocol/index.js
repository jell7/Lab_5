export const PROTOCOL_VERSION = 1;

export const MSG_TYPE = {
  JOIN: 'join',
  ROSTER: 'roster',
  CHAT: 'chat',
  INPUT: 'input',
  SNAPSHOT: 'snapshot',
  WELCOME: 'welcome',
};

export function validateInputMessage(msg) {
  if (!msg || typeof msg !== 'object') return null;
  if (typeof msg.seq !== 'number' || !Number.isFinite(msg.seq) || msg.seq < 0) return null;
  const thrust = typeof msg.thrust === 'number' && Number.isFinite(msg.thrust)
    ? Math.max(-1, Math.min(1, msg.thrust))
    : 0;
  const turn = typeof msg.turn === 'number' && Number.isFinite(msg.turn)
    ? Math.max(-1, Math.min(1, msg.turn))
    : 0;
  const fire = Boolean(msg.fire);
  const tick = typeof msg.tick === 'number' && Number.isFinite(msg.tick) ? msg.tick : 0;

  return {
    type: MSG_TYPE.INPUT,
    seq: Math.floor(msg.seq),
    tick: Math.floor(tick),
    thrust,
    turn,
    fire,
  };
}