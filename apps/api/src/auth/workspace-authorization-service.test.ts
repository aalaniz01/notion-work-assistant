import type { WorkspaceMembershipRepository } from "@notion-work-assistant/db";
import { describe, expect, it } from "vitest";

import { AuthenticationUnavailableError } from "./errors.js";
import { ApplicationWorkspaceAuthorizationService } from "./workspace-authorization-service.js";

class FakeMembershipRepository implements WorkspaceMembershipRepository {
  authorized = true;
  failure: unknown;

  async listActiveForUser() {
    if (this.failure) throw this.failure;
    return this.authorized ? [{ id: "workspace-1", name: "Workspace" }] : [];
  }

  async hasActiveMembership() {
    if (this.failure) throw this.failure;
    return this.authorized;
  }
}

describe("ApplicationWorkspaceAuthorizationService", () => {
  it("returns only repository-authorized workspaces", async () => {
    const repository = new FakeMembershipRepository();
    const service = new ApplicationWorkspaceAuthorizationService(repository);

    await expect(service.listAuthorizedWorkspaces("user-1")).resolves.toEqual([
      { id: "workspace-1", name: "Workspace" },
    ]);
    await expect(service.hasAccess("user-1", "workspace-1")).resolves.toBe(
      true,
    );
  });

  it("rejects missing or revoked membership", async () => {
    const repository = new FakeMembershipRepository();
    repository.authorized = false;
    const service = new ApplicationWorkspaceAuthorizationService(repository);

    await expect(service.listAuthorizedWorkspaces("user-1")).resolves.toEqual(
      [],
    );
    await expect(service.hasAccess("user-1", "workspace-1")).resolves.toBe(
      false,
    );
  });

  it("maps repository failures to a safe unavailable error", async () => {
    const repository = new FakeMembershipRepository();
    repository.failure = new Error("unsafe database URL");
    const service = new ApplicationWorkspaceAuthorizationService(repository);

    await expect(
      service.hasAccess("user-1", "workspace-1"),
    ).rejects.toBeInstanceOf(AuthenticationUnavailableError);
  });
});
