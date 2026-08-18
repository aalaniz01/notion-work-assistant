import type {
  IdentityProvisioningRepository,
  ProvisionIdentityInput,
} from "@notion-work-assistant/db";
import { describe, expect, it } from "vitest";

import {
  OperatorProvisioningError,
  parseOperatorProvisioningArguments,
  provisionOperatorIdentity,
} from "./operator-provisioning.js";

const ISSUER = "https://identity.example.test";
const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-01-01T00:00:00.000Z");

class FakeProvisioningRepository implements IdentityProvisioningRepository {
  membershipActive = true;
  workspaceAvailable = true;
  provisioned: ProvisionIdentityInput | undefined;

  async workspaceExists() {
    return this.workspaceAvailable;
  }

  async provisionIdentityAndMembership(input: ProvisionIdentityInput) {
    this.provisioned = input;
    return { userId: "user-1", membershipActive: this.membershipActive };
  }
}

describe("operator OIDC identity provisioning", () => {
  it("parses each required operator input exactly once", () => {
    expect(
      parseOperatorProvisioningArguments([
        "--subject",
        "subject-1",
        "--workspace-id",
        WORKSPACE_ID,
        "--issuer",
        ISSUER,
      ]),
    ).toEqual({
      issuer: ISSUER,
      subject: "subject-1",
      workspaceId: WORKSPACE_ID,
    });
  });

  it("provisions the exact identity into an existing workspace", async () => {
    const repository = new FakeProvisioningRepository();

    await provisionOperatorIdentity({
      configuredIssuer: ISSUER,
      input: {
        issuer: ISSUER,
        subject: "subject-1",
        workspaceId: WORKSPACE_ID,
      },
      now: () => NOW,
      repository,
    });

    expect(repository.provisioned).toEqual({
      issuer: ISSUER,
      subject: "subject-1",
      workspaceId: WORKSPACE_ID,
      createdAt: NOW,
    });
  });

  it.each([
    [
      "issuer mismatch",
      {
        issuer: "https://attacker.example.test",
        subject: "subject-1",
        workspaceId: WORKSPACE_ID,
      },
    ],
    [
      "blank subject",
      { issuer: ISSUER, subject: " ", workspaceId: WORKSPACE_ID },
    ],
    [
      "long subject",
      { issuer: ISSUER, subject: "s".repeat(256), workspaceId: WORKSPACE_ID },
    ],
    [
      "invalid workspace ID",
      { issuer: ISSUER, subject: "subject-1", workspaceId: "not-a-uuid" },
    ],
  ])("rejects %s without provisioning", async (_label, input) => {
    const repository = new FakeProvisioningRepository();

    await expect(
      provisionOperatorIdentity({
        configuredIssuer: ISSUER,
        input,
        repository,
      }),
    ).rejects.toBeInstanceOf(OperatorProvisioningError);
    expect(repository.provisioned).toBeUndefined();
  });

  it("rejects a missing workspace without provisioning", async () => {
    const repository = new FakeProvisioningRepository();
    repository.workspaceAvailable = false;

    await expect(
      provisionOperatorIdentity({
        configuredIssuer: ISSUER,
        input: {
          issuer: ISSUER,
          subject: "subject-1",
          workspaceId: WORKSPACE_ID,
        },
        repository,
      }),
    ).rejects.toThrow("Workspace does not exist");
    expect(repository.provisioned).toBeUndefined();
  });

  it("preserves a revoked membership and reports provisioning as unsuccessful", async () => {
    const repository = new FakeProvisioningRepository();
    repository.membershipActive = false;

    await expect(
      provisionOperatorIdentity({
        configuredIssuer: ISSUER,
        input: {
          issuer: ISSUER,
          subject: "subject-1",
          workspaceId: WORKSPACE_ID,
        },
        repository,
      }),
    ).rejects.toThrow("Workspace membership is revoked");
  });

  it.each([
    { arguments_: [] },
    { arguments_: ["--issuer", ISSUER] },
    {
      arguments_: [
        "--unknown",
        "value",
        "--subject",
        "subject-1",
        "--workspace-id",
        WORKSPACE_ID,
      ],
    },
    {
      arguments_: [
        "--issuer",
        ISSUER,
        "--issuer",
        ISSUER,
        "--workspace-id",
        WORKSPACE_ID,
      ],
    },
  ])("rejects malformed arguments %#", ({ arguments_ }) => {
    expect(() => parseOperatorProvisioningArguments(arguments_)).toThrow(
      OperatorProvisioningError,
    );
  });
});
