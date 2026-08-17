import type { PageObjectResponse } from "@notionhq/client";

import { NotionPropertyError, NotionRelationError } from "./errors.js";

type PageProperties = PageObjectResponse["properties"];

function malformed(pageId: string, propertyName: string): NotionPropertyError {
  return new NotionPropertyError(
    `Page ${pageId} has malformed property "${propertyName}"`,
  );
}

export function readRequiredTitle(
  properties: PageProperties,
  propertyName: string,
  pageId: string,
): string {
  const property = properties[propertyName];
  if (!property || property.type !== "title") {
    throw malformed(pageId, propertyName);
  }

  const value = property.title
    .map((item) => item.plain_text)
    .join("")
    .trim();
  if (!value) throw malformed(pageId, propertyName);
  return value;
}

export function readOptionalSelect(
  properties: PageProperties,
  propertyName: string,
  pageId: string,
): string | null {
  const property = properties[propertyName];
  if (!property) return null;
  if (property.type !== "select") throw malformed(pageId, propertyName);
  return property.select?.name.trim() || null;
}

export function readRequiredStatus(
  properties: PageProperties,
  propertyName: string,
  pageId: string,
): string {
  const property = properties[propertyName];
  if (!property || property.type !== "status" || !property.status) {
    throw malformed(pageId, propertyName);
  }

  const value = property.status.name.trim();
  if (!value) throw malformed(pageId, propertyName);
  return value;
}

export function readOptionalDate(
  properties: PageProperties,
  propertyName: string,
  pageId: string,
): string | null {
  const property = properties[propertyName];
  if (!property) return null;
  if (property.type !== "date") throw malformed(pageId, propertyName);
  if (!property.date) return null;
  if (!property.date.start.trim()) throw malformed(pageId, propertyName);
  return property.date.start;
}

export function readOptionalSingleRelation(
  properties: PageProperties,
  propertyName: string,
  pageId: string,
): string | null {
  const property = properties[propertyName];
  if (!property || property.type !== "relation") {
    throw malformed(pageId, propertyName);
  }

  const hasMore = (property as typeof property & { has_more?: unknown })
    .has_more;
  if (hasMore === true) {
    throw new NotionRelationError(
      `Page ${pageId} has a truncated relation in "${propertyName}"`,
    );
  }
  if (hasMore !== undefined && hasMore !== false) {
    throw malformed(pageId, propertyName);
  }

  if (property.relation.length === 0) return null;
  if (property.relation.length > 1) {
    throw new NotionRelationError(
      `Page ${pageId} has more than one relation in "${propertyName}"`,
    );
  }

  const relation = property.relation[0];
  if (!relation?.id) {
    throw new NotionRelationError(
      `Page ${pageId} has a malformed relation in "${propertyName}"`,
    );
  }
  return relation.id;
}
