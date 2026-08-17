import type { FastifyRequest } from "fastify";

import type { RequestSessionService } from "./types.js";

export const SESSION_COOKIE_NAME = "nwa_session";

export function authenticateRequest(
  request: FastifyRequest,
  sessions: RequestSessionService,
) {
  return sessions.authenticate(request.cookies[SESSION_COOKIE_NAME]);
}
