import type { IdentityProvisioningRepository } from "@notion-work-assistant/db";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface OperatorProvisioningInput {
  issuer: string;
  subject: string;
  workspaceId: string;
}

export class OperatorProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperatorProvisioningError";
  }
}

export function parseOperatorProvisioningArguments(
  arguments_: readonly string[],
): OperatorProvisioningInput {
  const values = new Map<string, string>();
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index];
    const value = arguments_[index + 1];
    if (
      !name ||
      !value ||
      !["--issuer", "--subject", "--workspace-id"].includes(name) ||
      values.has(name)
    ) {
      throw new OperatorProvisioningError(
        "Expected --issuer, --subject, and --workspace-id exactly once",
      );
    }
    values.set(name, value);
  }
  if (values.size !== 3 || arguments_.length !== 6) {
    throw new OperatorProvisioningError(
      "Expected --issuer, --subject, and --workspace-id exactly once",
    );
  }
  return {
    issuer: values.get("--issuer")!,
    subject: values.get("--subject")!,
    workspaceId: values.get("--workspace-id")!,
  };
}

export async function provisionOperatorIdentity(options: {
  configuredIssuer: string;
  input: OperatorProvisioningInput;
  now?: () => Date;
  repository: IdentityProvisioningRepository;
}): Promise<void> {
  const { input } = options;
  if (input.issuer !== options.configuredIssuer) {
    throw new OperatorProvisioningError(
      "Issuer must exactly match configured OIDC_ISSUER",
    );
  }
  if (
    input.subject.length < 1 ||
    input.subject.length > 255 ||
    input.subject.trim().length < 1
  ) {
    throw new OperatorProvisioningError(
      "Subject must contain between 1 and 255 characters",
    );
  }
  if (!UUID_PATTERN.test(input.workspaceId)) {
    throw new OperatorProvisioningError("Workspace ID must be a valid UUID");
  }
  if (!(await options.repository.workspaceExists(input.workspaceId))) {
    throw new OperatorProvisioningError("Workspace does not exist");
  }

  const result = await options.repository.provisionIdentityAndMembership({
    ...input,
    createdAt: (options.now ?? (() => new Date()))(),
  });
  if (!result.membershipActive) {
    throw new OperatorProvisioningError(
      "Workspace membership is revoked and was not reactivated",
    );
  }
}
