import { NextResponse, type NextRequest } from "next/server";

/*
 * Optimistic sign-in check before any page renders: no session cookie, no page. It only looks at whether the
 * cookie exists (the API validates it on every request), so it stays cheap. Keep PUBLIC in sync with lib/auth.tsx.
 */
const PUBLIC = ["/login", "/register", "/verify", "/forgot-password", "/reset-password", "/invite"];
// open to everyone (Area Intelligence is meant for citizens too); signed-in users see it inside the dashboard
const OPEN = ["/area-intelligence"];
const SESSION_COOKIE = "dw_session";

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (/\.[a-zA-Z0-9]+$/.test(pathname)) return NextResponse.next(); // static files (images, manifest, ...)
  const isPublic = [...PUBLIC, ...OPEN].some((p) => pathname === p || pathname.startsWith(`${p}/`));
  if (!isPublic && !request.cookies.has(SESSION_COOKIE)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  const response = NextResponse.next();
  // protected pages are never stored, so the back button after logout cannot show them from cache
  if (!isPublic) response.headers.set("Cache-Control", "no-store, must-revalidate");
  return response;
}

export const config = {
  // everything except the API (it checks sessions itself), Next.js assets, the service worker and static files
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|sw.js).*)"],
};
