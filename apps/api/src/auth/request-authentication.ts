import type { FastifyRequest } from "fastify";

import type { RequestSessionService } from "./types.js";

export const SESSION_COOKIE_NAME = "nwa_session";

export function hasDuplicateCookie(
  request: FastifyRequest,
  cookieName: string,
): boolean {
  const header = request.raw.headers.cookie;
  if (!header) return false;

  let occurrences = 0;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== cookieName) continue;
    occurrences += 1;
    if (occurrences > 1) return true;
  }
  return false;
}

export function authenticateRequest(
  request: FastifyRequest,
  sessions: RequestSessionService,
) {
  if (hasDuplicateCookie(request, SESSION_COOKIE_NAME)) {
    return sessions.authenticate(undefined);
  }
  return sessions.authenticate(request.cookies[SESSION_COOKIE_NAME]);
}
