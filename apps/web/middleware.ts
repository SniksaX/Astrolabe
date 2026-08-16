import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const SESSION_COOKIE = 'astrolabe_session';

/**
 * Edge-level presence check only — no JWT signature verification here
 * (edge runtime, no Node crypto). Real verification happens API-side via
 * modules/auth's requireJwt on every request; this just avoids rendering
 * a dashboard shell for an obviously-unauthenticated request.
 */
export function middleware(request: NextRequest): NextResponse {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/chat/:path*', '/sources/:path*', '/reglages/:path*', '/offre/:path*'],
};
