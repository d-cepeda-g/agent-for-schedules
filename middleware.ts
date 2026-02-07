import { NextRequest, NextResponse } from "next/server";

function unauthorizedResponse() {
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Call Scheduler"' },
  });
}

function parseBasicAuth(authHeader: string): { username: string; password: string } | null {
  if (!authHeader.startsWith("Basic ")) return null;

  const encoded = authHeader.slice("Basic ".length).trim();
  let decoded = "";
  try {
    decoded = atob(encoded);
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;

  const username = decoded.slice(0, separator);
  const password = decoded.slice(separator + 1);
  return { username, password };
}

function shouldSkip(pathname: string): boolean {
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  if (pathname.startsWith("/api/elevenlabs/webhook")) return true;
  if (pathname.includes(".") && !pathname.startsWith("/api/")) return true;
  return false;
}

export function middleware(request: NextRequest) {
  if (shouldSkip(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  const enabled =
    process.env.NODE_ENV === "production" ||
    process.env.ENABLE_BASIC_AUTH === "true";

  if (!enabled) return NextResponse.next();

  const expectedUser = process.env.BASIC_AUTH_USERNAME;
  const expectedPass = process.env.BASIC_AUTH_PASSWORD;

  if (!expectedUser || !expectedPass) {
    return new NextResponse("Basic auth is not configured on the server", {
      status: 500,
    });
  }

  const authHeader = request.headers.get("authorization");
  if (!authHeader) return unauthorizedResponse();

  const parsed = parseBasicAuth(authHeader);
  if (!parsed) return unauthorizedResponse();

  if (parsed.username !== expectedUser || parsed.password !== expectedPass) {
    return unauthorizedResponse();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/:path*"],
};
