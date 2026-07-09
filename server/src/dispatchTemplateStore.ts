/**
 * Dispatch template store (v2 mechanic G3 — GAME-DESIGN.md §7.3). A saved,
 * reusable dispatch config (machine/provider/cwd/prompt/model/effort,
 * optionally routed through an employee's defaults) — CallModal, chain
 * steps, and standing orders can all start from one instead of typing the
 * same prompt/target repeatedly. Cap 20.
 *
 * Persisted like progressionStore.ts (lazy homedir, 5s throttled persist,
 * tolerant load, onChange listener list, VITEST guard) at
 * ~/.pixel-agents/dispatch-templates.json.
 */

import { randomUUID } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { LAYOUT_FILE_DIR } from './constants.js';

const TEMPLATES_FILE_NAME = 'dispatch-templates.json';
const PERSIST_THROTTLE_MS = 5_000;

export const DISPATCH_TEMPLATE_MAX_COUNT = 20;

export interface DispatchTemplate {
  id: string;
  name: string;
  machine?: string;
  provider?: string;
  cwd?: string;
  prompt: string;
  model?: string;
  effort?: string;
  /** resolveEmployeeDefaults() fills machine/provider/cwd/model gaps —
   *  explicit fields above always win (GAME-DESIGN §7.3). */
  employeeId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DispatchTemplateInput {
  name: string;
  machine?: string;
  provider?: string;
  cwd?: string;
  prompt: string;
  model?: string;
  effort?: string;
  employeeId?: string;
}

export type DispatchTemplateResult =
  | { ok: true; template: DispatchTemplate }
  | { ok: false; reason: string };

function defaultTemplatesFile(): string {
  return path.join(os.homedir(), LAYOUT_FILE_DIR, TEMPLATES_FILE_NAME);
}

export class DispatchTemplateStore {
  private templates: Map<string, DispatchTemplate> | null = null;
  private lastPersistAt = 0;
  private explicitPath: string | undefined;
  private resolvedPath: string | undefined;
  private usingDefaultPath = false;
  private listeners: Array<(templates: DispatchTemplate[]) => void> = [];

  constructor(persistPath?: string) {
    this.explicitPath = persistPath;
  }

  onChange(listener: (templates: DispatchTemplate[]) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  create(input: DispatchTemplateInput, now: number = Date.now()): DispatchTemplateResult {
    if (typeof input.name !== 'string' || input.name.trim() === '') {
      return { ok: false, reason: 'missing-name' };
    }
    if (typeof input.prompt !== 'string' || input.prompt.trim() === '') {
      return { ok: false, reason: 'missing-prompt' };
    }
    const templates = this.ensureLoaded();
    if (templates.size >= DISPATCH_TEMPLATE_MAX_COUNT) {
      return { ok: false, reason: 'template-cap-exceeded' };
    }
    const template: DispatchTemplate = {
      id: randomUUID(),
      name: input.name,
      machine: input.machine,
      provider: input.provider,
      cwd: input.cwd,
      prompt: input.prompt,
      model: input.model,
      effort: input.effort,
      employeeId: input.employeeId,
      createdAt: now,
      updatedAt: now,
    };
    templates.set(template.id, template);
    this.finish(now);
    return { ok: true, template };
  }

  get(id: string): DispatchTemplate | undefined {
    return this.ensureLoaded().get(id);
  }

  getAll(): DispatchTemplate[] {
    return [...this.ensureLoaded().values()].sort((a, b) => a.createdAt - b.createdAt);
  }

  delete(id: string, now: number = Date.now()): { ok: true } {
    this.ensureLoaded().delete(id);
    this.finish(now);
    return { ok: true };
  }

  private finish(now: number): void {
    this.persist(now);
    const snapshot = this.getAll();
    for (const listener of this.listeners) listener(snapshot);
  }

  // ── Persistence (tolerant, throttled — same pattern as progressionStore.ts) ──

  private persistPath(): string {
    if (!this.resolvedPath) {
      this.usingDefaultPath = this.explicitPath === undefined;
      this.resolvedPath = this.explicitPath ?? defaultTemplatesFile();
    }
    return this.resolvedPath;
  }

  private ensureLoaded(): Map<string, DispatchTemplate> {
    if (!this.templates) this.templates = this.load();
    return this.templates;
  }

  private load(): Map<string, DispatchTemplate> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.persistPath(), 'utf8')) as unknown;
      if (!Array.isArray(raw)) return new Map();
      const map = new Map<string, DispatchTemplate>();
      for (const entry of raw as DispatchTemplate[]) {
        if (entry && typeof entry.id === 'string') map.set(entry.id, entry);
      }
      return map;
    } catch {
      return new Map();
    }
  }

  private persist(now: number, force = false): void {
    if (process.env.VITEST && this.usingDefaultPath) return;
    if (!force && now - this.lastPersistAt < PERSIST_THROTTLE_MS) return;
    this.lastPersistAt = now;
    const target = this.persistPath();
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify([...this.ensureLoaded().values()]), 'utf8');
    } catch {
      /* template loss on write failure is acceptable — never crash the server */
    }
  }
}

/** Process-wide instance (the server is single-process). */
export const dispatchTemplateStore = new DispatchTemplateStore();
