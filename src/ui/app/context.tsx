import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadBundledRegistry, type ContentRegistry } from "../../content";
import type { AwardLine, Promotion } from "../../domain";
import { DexieStorage } from "../../persistence/dexieStorage";
import type { StorageAdapter } from "../../persistence/storage";
import type { InstanceRow } from "../../persistence/types";
import { CommandService, ValidationError, type InstanceView } from "../../records/commands";

export interface Outcome {
  id: number;
  title: string;
  lines: AwardLine[];
  promotions: Promotion[];
}

interface AppState {
  registry: ContentRegistry;
  storage: StorageAdapter;
  service: CommandService;
  instances: InstanceRow[];
  currentId: string | null;
  view: InstanceView | null;
  loading: boolean;
  error: string | null;
  outcome: Outcome | null;
  selectInstance(id: string | null): void;
  reload(): Promise<void>;
  /** Run a command; on success reload and show its XP outcome. Returns false (and shows errors) on failure. */
  run<T>(title: string, command: () => Promise<T>, extract?: (result: T) => { lines: AwardLine[]; promotions: Promotion[] }): Promise<T | null>;
  dismissOutcome(): void;
  clearError(): void;
}

const Ctx = createContext<AppState | null>(null);
const CURRENT_KEY = "meridian.currentInstance";

export function AppProvider({ children }: { children: ReactNode }) {
  const registry = useMemo(() => loadBundledRegistry(), []);
  const storage = useMemo(() => new DexieStorage(), []);
  const service = useMemo(() => new CommandService(storage, registry), [storage, registry]);

  const [instances, setInstances] = useState<InstanceRow[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [view, setView] = useState<InstanceView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const outcomeSeq = useRef(0);

  const showOutcome = useCallback((title: string, lines: AwardLine[], promotions: Promotion[]) => {
    if (lines.length === 0 && promotions.length === 0) return;
    outcomeSeq.current += 1;
    setOutcome({ id: outcomeSeq.current, title, lines, promotions });
  }, []);

  const loadAll = useCallback(
    async (preferredId: string | null) => {
      const list = await service.listInstances();
      setInstances(list);
      const id = list.some((i) => i.id === preferredId) ? preferredId : (list[0]?.id ?? null);
      setCurrentId(id);
      remember(id);
      setView(id ? await service.load(id) : null);
    },
    [service],
  );

  // Initial load: restore the last map and let time-based gates promote.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const preferred = recall();
        const list = await service.listInstances();
        const id = list.some((i) => i.id === preferred) ? preferred : (list[0]?.id ?? null);
        if (id) {
          const promotions = await service.refreshTime(id);
          if (!cancelled) showOutcome("Time well spent", [], promotions);
        }
        if (!cancelled) await loadAll(id);
      } catch (e) {
        if (!cancelled) setError(messageOf(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [service, loadAll, showOutcome]);

  const reload = useCallback(() => loadAll(currentId), [loadAll, currentId]);

  const selectInstance = useCallback(
    (id: string | null) => {
      setOutcome(null);
      void (async () => {
        try {
          if (id) {
            const promotions = await service.refreshTime(id);
            showOutcome("Time well spent", [], promotions);
          }
          await loadAll(id);
        } catch (e) {
          setError(messageOf(e));
        }
      })();
    },
    [service, loadAll, showOutcome],
  );

  const run = useCallback<AppState["run"]>(
    async (title, command, extract) => {
      setError(null);
      try {
        const result = await command();
        await loadAll(recall() ?? currentId);
        if (extract) {
          const { lines, promotions } = extract(result);
          showOutcome(title, lines, promotions);
        }
        return result;
      } catch (e) {
        setError(messageOf(e));
        return null;
      }
    },
    [loadAll, currentId, showOutcome],
  );

  const value: AppState = {
    registry,
    storage,
    service,
    instances,
    currentId,
    view,
    loading,
    error,
    outcome,
    selectInstance,
    reload,
    run,
    dismissOutcome: () => setOutcome(null),
    clearError: () => setError(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp must be used inside AppProvider");
  return ctx;
}

/** The current map's view; only call from screens rendered when a map is loaded. */
export function useView(): InstanceView {
  const { view } = useApp();
  if (!view) throw new Error("No map is loaded");
  return view;
}

export function rememberInstance(id: string | null): void {
  remember(id);
}

function remember(id: string | null): void {
  try {
    if (id) localStorage.setItem(CURRENT_KEY, id);
    else localStorage.removeItem(CURRENT_KEY);
  } catch {
    // Storage can be unavailable (private mode); the app still works without it.
  }
}

function recall(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

function messageOf(e: unknown): string {
  if (e instanceof ValidationError) return e.errors.join(" ");
  if (e instanceof Error) return e.message;
  return String(e);
}
