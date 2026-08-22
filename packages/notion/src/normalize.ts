import type {
  Client as DomainClient,
  TaskStatus,
} from "@notion-work-assistant/domain";
import type { PageObjectResponse } from "@notionhq/client";

import { NotionValidationError } from "./errors.js";
import type { PropertyMap } from "./property-map.js";
import {
  readOptionalDate,
  readOptionalSelect,
  readRequiredStatus,
  readRequiredTitle,
  readOptionalSingleRelation,
} from "./properties.js";
import type { NotionTask } from "./types.js";

const STATUS_ALIASES = new Map<string, TaskStatus>([
  ["not started", "NOT_STARTED"],
  ["not_started", "NOT_STARTED"],
  ["in progress", "IN_PROGRESS"],
  ["in_progress", "IN_PROGRESS"],
  ["waiting approval", "WAITING_APPROVAL"],
  ["waiting_approval", "WAITING_APPROVAL"],
  ["changes requested", "CHANGES_REQUESTED"],
  ["changes_requested", "CHANGES_REQUESTED"],
  ["approved", "APPROVED"],
  ["done", "APPROVED"],
]);

function normalizeStatus(value: string, pageId: string): TaskStatus {
  const status = STATUS_ALIASES.get(value.trim().toLowerCase());
  if (!status) {
    throw new NotionValidationError(`Page ${pageId} has an unknown status`);
  }
  return status;
}

export function normalizeClient(
  page: PageObjectResponse,
  properties: PropertyMap["clients"],
): DomainClient {
  return {
    id: page.id,
    name: readRequiredTitle(page.properties, properties.name, page.id),
  };
}

export function normalizeTask(
  page: PageObjectResponse,
  properties: PropertyMap["tasks"],
): NotionTask | null {
  const clientId = readOptionalSingleRelation(
    page.properties,
    properties.clientRelation,
    page.id,
  );
  if (!clientId) return null;

  return {
    id: page.id,
    title: readRequiredTitle(page.properties, properties.title, page.id),
    clientId,
    taskType: readOptionalSelect(page.properties, properties.taskType, page.id),
    dueDate: readOptionalDate(page.properties, properties.dueDate, page.id),
    status: normalizeStatus(
      readRequiredStatus(page.properties, properties.status, page.id),
      page.id,
    ),
    priority: readOptionalSelect(page.properties, properties.priority, page.id),
    createdAt: page.created_time,
  };
}
