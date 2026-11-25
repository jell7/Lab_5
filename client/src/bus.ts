import type { EntityId, SnapshotMessage } from 'shared/protocol';

export type GameEvents = {
  welcome: { readonly playerId: EntityId; readonly room: string };
  snapshot: SnapshotMessage;
  roster: { readonly players: readonly string[] };
  chat: { readonly name: string; readonly text: string };
  rtt: { readonly rttMs: number };
};

export class TypedBus<E extends Record<string, unknown>> {
  private readonly handlers = new Map<keyof E, Set<(payload: never) => void>>();

  on<K extends keyof E>(event: K, fn: (payload: E[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    const wrapped = fn as (payload: never) => void;
    set.add(wrapped);
    return () => {
      set.delete(wrapped);
    };
  }

  emit<K extends keyof E>(event: K, payload: E[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const fn of set) {
      (fn as (p: E[K]) => void)(payload);
    }
  }
}