import { useEffect, useState } from "react";

export type Route = { page: "world" } | { page: "hq" } | { page: "production" } | { page: "islands"; islandId?: string } | { page: "trophies" } | { page: "wharf" } | { page: "inbox" } | { page: "audit" } | { page: "archive" };

export function parseRoute(hash: string): Route {
  const [page, arg] = hash.replace(/^#\/?/, "").split("/");
  switch (page) {
    case "production":
      return { page: "production" };
    case "islands":
      return arg ? { page: "islands", islandId: decodeURIComponent(arg) } : { page: "islands" };
    case "archive":
      return { page: "archive" };
    case "trophies":
      return { page: "trophies" };
    case "hq":
      return { page: "hq" };
    case "wharf":
      return { page: "wharf" };
    case "inbox":
      return { page: "inbox" };
    case "audit":
      return { page: "audit" };
    default:
      return { page: "world" };
  }
}

export function href(route: Route): string {
  if (route.page === "islands" && route.islandId) return `#/islands/${encodeURIComponent(route.islandId)}`;
  return `#/${route.page}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}
