import { timingSafeEqual } from "node:crypto";

import type { FastifyInstance, FastifyReply } from "fastify";

import {
  clearOidcAttemptCookie,
  clearSessionCookie,
  OIDC_ATTEMPT_COOKIE_NAME,
  setOidcAttemptCookie,
  setSessionCookie,
} from "../auth/auth-cookies.js";
import type { ApplicationSessionConfiguration } from "../auth/oidc-config.js";
import { AuthenticationUnavailableError } from "../auth/errors.js";
import { OidcIdentityNotAuthorizedError } from "../auth/oidc-login-service.js";
import type { OidcLoginService } from "../auth/oidc-login-service.js";
import {
  OidcAccessDeniedError,
  OidcCallbackValidationError,
  OidcProviderUnavailableError,
} from "../auth/oidc-provider.js";
import type { OidcTransientStateService } from "../auth/oidc-transient-state.js";
import {
  authenticateRequest,
  hasDuplicateCookie,
  SESSION_COOKIE_NAME,
} from "../auth/request-authentication.js";
import type { SessionService } from "../auth/session-service.js";

type PublicAuthError =
  | "access_denied"
  | "authentication_failed"
  | "not_authorized"
  | "service_unavailable";

export interface OidcRouteRuntime {
  applicationOrigin: URL;
  callbackUrl: URL;
  login: OidcLoginService;
  now?: () => Date;
  secureCookies: boolean;
  transientState: OidcTransientStateService;
}

interface AuthLifecycleRouteOptions {
  oidc?: OidcRouteRuntime;
  sessionCookies?: ApplicationSessionConfiguration;
  sessions: SessionService;
}

function valuesMatch(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function callbackFailureLocation(error: PublicAuthError): string {
  return `/?auth_error=${error}`;
}

function sendCallbackFailure(reply: FastifyReply, error: PublicAuthError) {
  return reply.redirect(callbackFailureLocation(error), 303);
}

export async function registerAuthLifecycleRoutes(
  app: FastifyInstance,
  options: AuthLifecycleRouteOptions,
): Promise<void> {
  const now = options.oidc?.now ?? (() => new Date());

  app.get("/api/auth/login", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!options.oidc) {
      return reply
        .status(503)
        .send({ error: { code: "OIDC_UNAVAILABLE" as const } });
    }

    try {
      if (hasDuplicateCookie(request, SESSION_COOKIE_NAME)) {
        return reply
          .status(400)
          .send({ error: { code: "AUTH_COOKIE_AMBIGUOUS" as const } });
      }
      const principal = await authenticateRequest(request, options.sessions);
      if (principal) return reply.redirect("/", 302);
      if (request.cookies[SESSION_COOKIE_NAME]) {
        clearSessionCookie(reply, options.oidc.secureCookies);
      }

      const authorization =
        await options.oidc.login.provider.createAuthorizationRequest();
      const attempt = await options.oidc.transientState.seal({
        state: authorization.state,
        nonce: authorization.nonce,
        codeVerifier: authorization.codeVerifier,
      });
      setOidcAttemptCookie(
        reply,
        attempt.value,
        attempt.expiresAt,
        options.oidc.secureCookies,
        now(),
      );
      return reply.redirect(authorization.url.href, 302);
    } catch (error) {
      if (
        error instanceof AuthenticationUnavailableError ||
        error instanceof OidcProviderUnavailableError
      ) {
        return reply
          .status(503)
          .send({ error: { code: "OIDC_UNAVAILABLE" as const } });
      }
      throw error;
    }
  });

  app.get("/api/auth/callback", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("Referrer-Policy", "no-referrer");
    clearOidcAttemptCookie(reply, options.oidc?.secureCookies ?? false);

    if (!options.oidc) {
      return sendCallbackFailure(reply, "service_unavailable");
    }

    try {
      if (hasDuplicateCookie(request, OIDC_ATTEMPT_COOKIE_NAME)) {
        return sendCallbackFailure(reply, "authentication_failed");
      }
      const attempt = await options.oidc.transientState.unseal(
        request.cookies[OIDC_ATTEMPT_COOKIE_NAME],
      );
      const callbackUrl = new URL(request.url, options.oidc.applicationOrigin);
      if (
        callbackUrl.origin !== options.oidc.applicationOrigin.origin ||
        callbackUrl.pathname !== options.oidc.callbackUrl.pathname
      ) {
        return sendCallbackFailure(reply, "authentication_failed");
      }
      const states = callbackUrl.searchParams.getAll("state");
      if (states.length !== 1 || !valuesMatch(states[0]!, attempt.state)) {
        return sendCallbackFailure(reply, "authentication_failed");
      }

      const identity = await options.oidc.login.provider.validateCallback(
        callbackUrl,
        attempt,
      );
      const session =
        await options.oidc.login.createSessionForIdentity(identity);
      setSessionCookie(
        reply,
        session.token,
        session.expiresAt,
        options.oidc.secureCookies,
        now(),
      );
      return reply.redirect("/", 303);
    } catch (error) {
      if (error instanceof OidcAccessDeniedError) {
        return sendCallbackFailure(reply, "access_denied");
      }
      if (error instanceof OidcIdentityNotAuthorizedError) {
        return sendCallbackFailure(reply, "not_authorized");
      }
      if (
        error instanceof OidcProviderUnavailableError ||
        error instanceof AuthenticationUnavailableError
      ) {
        return sendCallbackFailure(reply, "service_unavailable");
      }
      if (error instanceof OidcCallbackValidationError) {
        return sendCallbackFailure(reply, "authentication_failed");
      }
      return sendCallbackFailure(reply, "authentication_failed");
    }
  });

  app.post("/api/auth/logout", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!request.headers.origin) {
      return reply
        .status(403)
        .send({ error: { code: "INVALID_ORIGIN" as const } });
    }
    const sessionCookies = options.sessionCookies;
    if (!sessionCookies) {
      return reply
        .status(503)
        .send({ error: { code: "AUTH_CONFIGURATION_UNAVAILABLE" as const } });
    }
    if (request.headers.origin !== sessionCookies.applicationOrigin.origin) {
      return reply
        .status(403)
        .send({ error: { code: "INVALID_ORIGIN" as const } });
    }

    clearSessionCookie(reply, sessionCookies.secureCookies);
    if (hasDuplicateCookie(request, SESSION_COOKIE_NAME)) {
      return reply
        .status(400)
        .send({ error: { code: "AUTH_COOKIE_AMBIGUOUS" as const } });
    }
    try {
      await options.sessions.revoke(request.cookies[SESSION_COOKIE_NAME]);
      return reply.status(204).send();
    } catch (error) {
      if (error instanceof AuthenticationUnavailableError) {
        return reply
          .status(503)
          .send({ error: { code: "AUTH_UNAVAILABLE" as const } });
      }
      throw error;
    }
  });
}
