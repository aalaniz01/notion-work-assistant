import { describe, expect, it } from "vitest";

import { encodeIdentityAdvisoryLockInput } from "./identity-provisioning-repository.js";

describe("identity provisioning advisory lock", () => {
  it("uses an unambiguous encoding for identity components", () => {
    const separator = String.fromCharCode(31);
    const first = { issuer: "a", subject: `${separator}b` };
    const second = { issuer: `a${separator}`, subject: "b" };

    expect(`${first.issuer}${separator}${first.subject}`).toBe(
      `${second.issuer}${separator}${second.subject}`,
    );
    expect(
      encodeIdentityAdvisoryLockInput(first.issuer, first.subject),
    ).not.toBe(encodeIdentityAdvisoryLockInput(second.issuer, second.subject));
  });
});
