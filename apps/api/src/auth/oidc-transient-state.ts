import { CompactEncrypt, compactDecrypt } from "jose";

const ATTEMPT_VERSION = 1;
const ATTEMPT_DURATION_MS = 10 * 60 * 1_000;
const MAX_ATTEMPT_VALUE_LENGTH = 512;
const MAX_ENCRYPTED_ATTEMPT_LENGTH = 4_096;

export interface OidcLoginAttempt {
  version: 1;
  state: string;
  nonce: string;
  codeVerifier: string;
  issuedAt: number;
  expiresAt: number;
}

export class InvalidOidcLoginAttemptError extends Error {
  constructor() {
    super("OIDC login attempt is invalid or expired");
    this.name = "InvalidOidcLoginAttemptError";
  }
}

interface OidcTransientStateOptions {
  now?: () => Date;
  durationMs?: number;
}

function isBoundedString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ATTEMPT_VALUE_LENGTH
  );
}

function isLoginAttempt(value: unknown): value is OidcLoginAttempt {
  if (!value || typeof value !== "object") return false;
  const attempt = value as Partial<OidcLoginAttempt>;
  return (
    attempt.version === ATTEMPT_VERSION &&
    isBoundedString(attempt.state) &&
    isBoundedString(attempt.nonce) &&
    isBoundedString(attempt.codeVerifier) &&
    Number.isSafeInteger(attempt.issuedAt) &&
    Number.isSafeInteger(attempt.expiresAt) &&
    attempt.expiresAt! > attempt.issuedAt!
  );
}

export class OidcTransientStateService {
  private readonly now: () => Date;
  private readonly durationMs: number;

  constructor(
    private readonly key: Uint8Array,
    options: OidcTransientStateOptions = {},
  ) {
    if (key.length !== 32) {
      throw new RangeError("OIDC transient-state key must contain 32 bytes");
    }
    this.now = options.now ?? (() => new Date());
    this.durationMs = options.durationMs ?? ATTEMPT_DURATION_MS;
  }

  async seal(input: {
    state: string;
    nonce: string;
    codeVerifier: string;
  }): Promise<{ value: string; expiresAt: Date }> {
    const issuedAt = this.now().getTime();
    const expiresAt = issuedAt + this.durationMs;
    const attempt: OidcLoginAttempt = {
      version: ATTEMPT_VERSION,
      ...input,
      issuedAt,
      expiresAt,
    };
    if (!isLoginAttempt(attempt)) throw new InvalidOidcLoginAttemptError();

    const value = await new CompactEncrypt(
      new TextEncoder().encode(JSON.stringify(attempt)),
    )
      .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
      .encrypt(this.key);

    return { value, expiresAt: new Date(expiresAt) };
  }

  async unseal(value: string | undefined): Promise<OidcLoginAttempt> {
    if (!value || value.length > MAX_ENCRYPTED_ATTEMPT_LENGTH) {
      throw new InvalidOidcLoginAttemptError();
    }

    try {
      const { plaintext, protectedHeader } = await compactDecrypt(
        value,
        this.key,
        {
          keyManagementAlgorithms: ["dir"],
          contentEncryptionAlgorithms: ["A256GCM"],
        },
      );
      if (protectedHeader.alg !== "dir" || protectedHeader.enc !== "A256GCM") {
        throw new InvalidOidcLoginAttemptError();
      }

      const attempt: unknown = JSON.parse(new TextDecoder().decode(plaintext));
      if (!isLoginAttempt(attempt)) throw new InvalidOidcLoginAttemptError();

      const now = this.now().getTime();
      if (attempt.issuedAt > now || attempt.expiresAt <= now) {
        throw new InvalidOidcLoginAttemptError();
      }
      return attempt;
    } catch (error) {
      if (error instanceof InvalidOidcLoginAttemptError) throw error;
      throw new InvalidOidcLoginAttemptError();
    }
  }
}
