import type { FastifyReply } from "fastify";

import { SESSION_COOKIE_NAME } from "./request-authentication.js";

export const OIDC_ATTEMPT_COOKIE_NAME = "nwa_oidc_attempt";
export const OIDC_ATTEMPT_COOKIE_PATH = "/api/auth/callback";

export function setOidcAttemptCookie(
  reply: FastifyReply,
  value: string,
  expiresAt: Date,
  secure: boolean,
  now: Date,
): void {
  reply.setCookie(OIDC_ATTEMPT_COOKIE_NAME, value, {
    expires: expiresAt,
    httpOnly: true,
    maxAge: Math.max(
      0,
      Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
    ),
    path: OIDC_ATTEMPT_COOKIE_PATH,
    sameSite: "lax",
    secure,
  });
}

export function clearOidcAttemptCookie(
  reply: FastifyReply,
  secure: boolean,
): void {
  reply.clearCookie(OIDC_ATTEMPT_COOKIE_NAME, {
    httpOnly: true,
    path: OIDC_ATTEMPT_COOKIE_PATH,
    sameSite: "lax",
    secure,
  });
}

export function setSessionCookie(
  reply: FastifyReply,
  value: string,
  expiresAt: Date,
  secure: boolean,
  now: Date,
): void {
  reply.setCookie(SESSION_COOKIE_NAME, value, {
    expires: expiresAt,
    httpOnly: true,
    maxAge: Math.max(
      0,
      Math.floor((expiresAt.getTime() - now.getTime()) / 1000),
    ),
    path: "/",
    sameSite: "lax",
    secure,
  });
}

export function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  reply.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure,
  });
}
