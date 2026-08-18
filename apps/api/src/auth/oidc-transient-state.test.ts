import { describe, expect, it } from "vitest";

import {
  InvalidOidcLoginAttemptError,
  OidcTransientStateService,
} from "./oidc-transient-state.js";

const KEY = new Uint8Array(32).fill(9);
const NOW = new Date("2026-01-01T00:00:00.000Z");

function service(now = NOW) {
  return new OidcTransientStateService(KEY, {
    now: () => now,
    durationMs: 60_000,
  });
}

describe("OIDC transient state", () => {
  it("encrypts and authenticates a complete short-lived login attempt", async () => {
    const input = {
      state: "state-value",
      nonce: "independent-nonce",
      codeVerifier: "pkce-verifier",
    };

    const sealed = await service().seal(input);
    const unsealed = await service().unseal(sealed.value);

    expect(sealed.value).not.toContain(input.state);
    expect(sealed.value).not.toContain(input.nonce);
    expect(sealed.value).not.toContain(input.codeVerifier);
    expect(sealed.expiresAt).toEqual(new Date(NOW.getTime() + 60_000));
    expect(unsealed).toEqual({
      version: 1,
      ...input,
      issuedAt: NOW.getTime(),
      expiresAt: NOW.getTime() + 60_000,
    });
  });

  it("rejects missing, tampered, and expired attempts", async () => {
    await expect(service().unseal(undefined)).rejects.toBeInstanceOf(
      InvalidOidcLoginAttemptError,
    );

    const sealed = await service().seal({
      state: "state-value",
      nonce: "nonce-value",
      codeVerifier: "pkce-verifier",
    });
    const segments = sealed.value.split(".");
    const ciphertext = segments[3]!;
    const replacement = ciphertext.startsWith("a") ? "b" : "a";
    segments[3] = `${replacement}${ciphertext.slice(1)}`;
    const tampered = segments.join(".");
    await expect(service().unseal(tampered)).rejects.toBeInstanceOf(
      InvalidOidcLoginAttemptError,
    );
    await expect(
      service(new Date(NOW.getTime() + 60_000)).unseal(sealed.value),
    ).rejects.toBeInstanceOf(InvalidOidcLoginAttemptError);
  });

  it("requires a 256-bit encryption key", () => {
    expect(() => new OidcTransientStateService(new Uint8Array(31))).toThrow(
      RangeError,
    );
  });

  it("rejects oversized ciphertext before attempting decryption", async () => {
    await expect(service().unseal("a".repeat(4_097))).rejects.toBeInstanceOf(
      InvalidOidcLoginAttemptError,
    );
  });
});
