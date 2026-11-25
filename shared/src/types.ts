export type EntityId = number & { readonly __brand: 'EntityId' };
export type Tick = number & { readonly __brand: 'Tick' };
export type Seq = number & { readonly __brand: 'Seq' };

export function asEntityId(n: number): EntityId {
  // Branded constructor: надає номінальну безпеку примітиву number без витрат у рантаймі
  return (n >>> 0) as EntityId;
}

export function asTick(n: number): Tick {
  // Branded constructor: відокремлює номер тіку від EntityId та Seq
  return (n >>> 0) as Tick;
}

export function asSeq(n: number): Seq {
  // Branded constructor: гарантує, що seq інпуту не переплутають із тіком чи ID
  return (n >>> 0) as Seq;
}

export interface Vector2 {
  readonly x: number;
  readonly y: number;
}

export interface ShipEntity {
  readonly kind: 'ship';
  readonly id: EntityId;
  readonly name: string;
  readonly pos: Vector2;
  readonly vel: Vector2;
  readonly angle: number;
  readonly hp: number;
  readonly cooldown: number;
  readonly lastProcessedSeq: Seq;
}

export interface BulletEntity {
  readonly kind: 'bullet';
  readonly id: EntityId;
  readonly ownerId: EntityId;
  readonly pos: Vector2;
  readonly vel: Vector2;
  readonly ttl: number;
}

export type EntitySnapshot = ShipEntity | BulletEntity;

export interface WorldState {
  readonly tick: Tick;
  readonly seed: number;
  readonly nextBulletId: number;
  readonly ships: readonly ShipEntity[];
  readonly bullets: readonly BulletEntity[];
}

export interface PlayerInput {
  readonly seq: Seq;
  readonly tick: Tick;
  readonly thrust: number;
  readonly turn: number;
  readonly fire: boolean;
}