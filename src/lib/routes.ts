/** Paths reachable without signing in. Everything else requires a session. */
const PUBLIC_PATHS = ["/login", "/auth/confirm"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}
