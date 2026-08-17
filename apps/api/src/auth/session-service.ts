import { createHash, randomBytes } from "node:crypto";

import type { SessionRepository } from "@notion-work-assistant/db";

import {
  AuthenticationUnavailableError,
  SessionCreationError,
} from "./errors.js";
import type { AuthenticatedPrincipal, RequestSessionService } from "./types.js";

const SESSION_DURATION_MS = 8 * 60 * 60 * 1_000;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export interface CreatedSession {
  token: string;
  expiresAt: Date;
}

export interface SessionService extends RequestSessionService {
  create(userId: string): Promise<CreatedSession>;
  revoke(rawToken: string | undefined): Promise<void>;
}

interface SessionServiceOptions {
  now?: () => Date;
  generateToken?: () => string;
  sessionDurationMs?: number;
}

export function hashSessionToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function isValidSessionToken(
  rawToken: string | undefined,
): rawToken is string {
  return rawToken !== undefined && SESSION_TOKEN_PATTERN.test(rawToken);
}

export class ApplicationSessionService implements SessionService {
  private readonly now: () => Date;
  private readonly generateToken: () => string;
  private readonly sessionDurationMs: number;

  constructor(
    private readonly repository: SessionRepository,
    options: SessionServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.generateToken =
      options.generateToken ?? (() => randomBytes(32).toString("base64url"));
    this.sessionDurationMs = options.sessionDurationMs ?? SESSION_DURATION_MS;
  }

  async create(userId: string): Promise<CreatedSession> {
    try {
      const user = await this.repository.findUserById(userId);
      if (!user || user.disabledAt) throw new SessionCreationError();

      const createdAt = this.now();
      const expiresAt = new Date(createdAt.getTime() + this.sessionDurationMs);
      const token = this.generateToken();
      if (!SESSION_TOKEN_PATTERN.test(token)) throw new SessionCreationError();

      await this.repository.create({
        userId,
        tokenHash: hashSessionToken(token),
        createdAt,
        expiresAt,
      });
      return { token, expiresAt };
    } catch (error) {
      if (error instanceof SessionCreationError) throw error;
      throw new AuthenticationUnavailableError(error);
    }
  }

  async authenticate(
    rawToken: string | undefined,
  ): Promise<AuthenticatedPrincipal | null> {
    if (!isValidSessionToken(rawToken)) return null;

    try {
      const session = await this.repository.findByTokenHash(
        hashSessionToken(rawToken),
      );
      if (
        !session ||
        session.disabledAt ||
        session.revokedAt ||
        session.expiresAt.getTime() <= this.now().getTime()
      ) {
        return null;
      }
      return { userId: session.userId };
    } catch (error) {
      throw new AuthenticationUnavailableError(error);
    }
  }

  async revoke(rawToken: string | undefined): Promise<void> {
    if (!isValidSessionToken(rawToken)) return;

    try {
      await this.repository.revoke(hashSessionToken(rawToken), this.now());
    } catch (error) {
      throw new AuthenticationUnavailableError(error);
    }
  }
}
