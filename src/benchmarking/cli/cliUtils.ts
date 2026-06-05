//ai generated parsing of cli args
import * as fs from "node:fs";

export function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}

export function asInt(v: any): number {
  if (typeof v !== "string") {
    throw new Error("Expected integer argument (string value required)");
  }
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid integer value: ${v}`);
  }
  return n;
}

export function asFloat(v: any): number {
  if (typeof v !== "string") {
    throw new Error("Expected float argument (string value required)");
  }
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid float value: ${v}`);
  }
  return n;
}

export function asString<T extends string>(v: any): T {
  if (typeof v !== "string") {
    throw new Error("Expected string argument");
  }
  return v as T;
}

export function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}
