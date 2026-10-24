import { useState } from "react";
import { AppProvider, useApp } from "./app/context";
import { OutcomePanel } from "./components/OutcomePanel";
import { QuickLog } from "./components/QuickLog";
import { Archive, NewInstance } from "./pages/Archive";
import { HQ } from "./pages/HQ";
import { Islands } from "./pages/Islands";
import { Production } from "./pages/Production";
import { Trophies } from "./pages/Trophies";
import { Wharf } from "./pages/Wharf";
import { Inbox } from "./pages/Inbox";
import { Audit } from "./pages/Audit";
import { World } from "./pages/World";
import { href, useRoute, type Route } from "./routes";

export function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}

const NAV: { route: Route; label: string }[] = [
  { route: { page: "world" }, label: "World" },
  { route: { page: "hq" }, label: "Headquarters" },
  { route: { page: "production" }, label: "Production Office" },
  { route: { page: "islands" }, label: "Islands" },
  { route: { page: "trophies" }, label: "Trophy Hall" },
  { route: { page: "inbox" }, label: "Inbox" },
  { route: { page: "archive" }, label: "Archive House" },
];

function Shell() {
  const { loading, view, instances, currentId, selectInstance, error, clearError } = useApp();
  const route = useRoute();
  const [logging, setLogging] = useState(false);
  const pending = view?.bundle.submissions.filter((s) => s.status === "pending").length ?? 0;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href={href({ page: "world" })}>
          <span className="brand-mark" aria-hidden>
            ◆
          </span>
          Meridian Isles
        </a>
        {view && (
          <nav className="nav">
            {NAV.map((n) => (
              <a key={n.label} href={href(n.route)} className={route.page === n.route.page ? "active" : ""}>
                {n.label}
                {n.route.page === "inbox" && pending > 0 && <span className="nav-count" aria-label={`${pending} waiting`}>{pending}</span>}
              </a>
            ))}
          </nav>
        )}
        <span className="spacer" />
        {instances.length > 1 && (
          <select className="instance-switch" value={currentId ?? ""} onChange={(e) => selectInstance(e.target.value)} aria-label="Current map">
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
        )}
        {view && (
          <button className="btn primary" onClick={() => setLogging(true)}>
            + Log activity
          </button>
        )}
      </header>

      {error && (
        <div className="error-bar" role="alert">
          <span>{error}</span>
          <button className="icon-btn" onClick={clearError} aria-label="Dismiss error">
            ×
          </button>
        </div>
      )}

      <main className="content">
        {loading ? (
          <p className="muted">Loading…</p>
        ) : !view ? (
          <div className="onboarding">
            <NewInstance first />
          </div>
        ) : route.page === "production" ? (
          <Production />
        ) : route.page === "islands" ? (
          <Islands islandId={route.islandId} />
        ) : route.page === "trophies" ? (
          <Trophies />
        ) : route.page === "archive" ? (
          <Archive />
        ) : route.page === "inbox" ? (
          <Inbox />
        ) : route.page === "audit" ? (
          <Audit />
        ) : route.page === "wharf" ? (
          <Wharf />
        ) : route.page === "hq" ? (
          <HQ />
        ) : (
          <World />
        )}
      </main>

      {logging && <QuickLog onClose={() => setLogging(false)} />}
      <OutcomePanel />
    </div>
  );
}
