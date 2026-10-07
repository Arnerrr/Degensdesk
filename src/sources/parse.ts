// Helpers for reading untyped JSON from third-party APIs without trusting its shape.

export type Obj = Record<string, unknown>;

export function obj(value: unknown): Obj | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : undefined;
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Numbers often arrive as strings ("0.05"); accept both. */
export function num(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** GoPlus encodes booleans as "0" / "1". */
export function flag01(value: unknown): boolean | undefined {
  if (value === "1" || value === 1 || value === true) return true;
  if (value === "0" || value === 0 || value === false) return false;
  return undefined;
}
