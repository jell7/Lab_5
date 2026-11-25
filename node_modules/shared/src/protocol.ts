import { z } from 'zod';
import {
  asEntityId,
  asSeq,
  asTick,
  type EntityId,
  type Seq,
  type Tick,
  type WorldState,
} from './types.js';

export const PROTOCOL_VERSION = 1 as const;

const EntityIdSchema = z.number().int().nonnegative().transform(asEntityId);
const TickSchema = z.number().int().nonnegative().transform(asTick);
const SeqSchema = z.number().int().nonnegative().transform(asSeq);

export const JoinMessageSchema = z.object({
  type: z.literal('join'),
  room: z.string().min(1).max(40),
  name: z.string().min(1).max(24),
  codec: z.enum(['binary', 'json']).optional(),
});

export const InputMessageSchema = z.object({
  type: z.literal('input'),
  seq: SeqSchema,
  tick: TickSchema,
  thrust: z.number().finite().min(-1).max(1),
  turn: z.number().finite().min(-1).max(1),
  fire: z.boolean(),
});

export const ChatMessageSchema = z.object({
  type: z.literal('chat'),
  text: z.string().min(1).max(300),
});

export const CodecSwitchMessageSchema = z.object({
  type: z.literal('codec'),
  codec: z.enum(['binary', 'json']),
});

export const PingRttMessageSchema = z.object({
  type: z.literal('ping_rtt'),
  t: z.number().finite(),
});

export const ClientMessageSchema = z.discriminatedUnion('type', [
  JoinMessageSchema,
  InputMessageSchema,
  ChatMessageSchema,
  CodecSwitchMessageSchema,
  PingRttMessageSchema,
]);

export type JoinMessage = z.infer<typeof JoinMessageSchema>;
export type InputMessage = z.infer<typeof InputMessageSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type CodecSwitchMessage = z.infer<typeof CodecSwitchMessageSchema>;
export type PingRttMessage = z.infer<typeof PingRttMessageSchema>;
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const Vector2Schema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

export const ShipSnapshotSchema = z.object({
  kind: z.literal('ship'),
  id: EntityIdSchema,
  name: z.string(),
  pos: Vector2Schema,
  vel: Vector2Schema,
  angle: z.number().finite(),
  hp: z.number().finite(),
  cooldown: z.number().finite(),
  lastProcessedSeq: SeqSchema,
});

export const BulletSnapshotSchema = z.object({
  kind: z.literal('bullet'),
  id: EntityIdSchema,
  ownerId: EntityIdSchema,
  pos: Vector2Schema,
  vel: Vector2Schema,
  ttl: z.number().finite(),
});

export const SnapshotMessageSchema = z.object({
  type: z.literal('snapshot'),
  tick: TickSchema,
  serverTime: z.number().finite(),
  yourId: EntityIdSchema,
  lastProcessedSeq: SeqSchema,
  state: z.object({
    tick: TickSchema,
    seed: z.number().int(),
    nextBulletId: z.number().int(),
    ships: z.array(ShipSnapshotSchema).readonly(),
    bullets: z.array(BulletSnapshotSchema).readonly(),
  }),
});

export const ServerMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    playerId: EntityIdSchema,
    room: z.string(),
    seed: z.number().int(),
  }),
  z.object({
    type: z.literal('roster'),
    players: z.array(z.string()),
  }),
  z.object({
    type: z.literal('chat'),
    name: z.string(),
    text: z.string(),
  }),
  z.object({
    type: z.literal('pong_rtt'),
    t: z.number().finite(),
  }),
  SnapshotMessageSchema,
]);

export type SnapshotMessage = z.infer<typeof SnapshotMessageSchema>;
export type ServerMessage = z.infer<typeof ServerMessageSchema>;

export type ParseResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: string };

export function parseClientMessage(raw: unknown): ParseResult<ClientMessage> {
  let candidate: unknown = raw;
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: 'Malformed JSON payload' };
    }
  }

  const parsed = ClientMessageSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid client message' };
  }
  return { ok: true, data: parsed.data };
}

export function parseServerMessage(raw: unknown): ParseResult<ServerMessage> {
  let candidate: unknown = raw;
  if (typeof raw === 'string') {
    try {
      candidate = JSON.parse(raw) as unknown;
    } catch {
      return { ok: false, error: 'Malformed server JSON' };
    }
  }

  const parsed = ServerMessageSchema.safeParse(candidate);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid server message' };
  }
  return { ok: true, data: parsed.data };
}

export { asEntityId, asSeq, asTick, type EntityId, type Tick, type Seq, type WorldState };