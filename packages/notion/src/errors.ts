export type NotionErrorCode =
  | "NOTION_CONFIG_ERROR"
  | "NOTION_UNAUTHORIZED"
  | "NOTION_RESTRICTED_RESOURCE"
  | "NOTION_OBJECT_NOT_FOUND"
  | "NOTION_RATE_LIMITED"
  | "NOTION_API_ERROR"
  | "NOTION_TIMEOUT"
  | "NOTION_NETWORK_ERROR"
  | "NOTION_SCHEMA_ERROR"
  | "NOTION_PROPERTY_ERROR"
  | "NOTION_VALIDATION_ERROR"
  | "NOTION_DATA_SOURCE_COUNT_ERROR"
  | "NOTION_ROW_LIMIT_ERROR"
  | "NOTION_RELATION_ERROR";

interface NotionErrorOptions {
  cause?: unknown;
  httpStatus?: number;
}

export class NotionAdapterError extends Error {
  readonly code: NotionErrorCode;
  readonly httpStatus?: number;

  constructor(
    code: NotionErrorCode,
    message: string,
    options: NotionErrorOptions = {},
  ) {
    super(message, { cause: options.cause });
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = options.httpStatus;
  }
}

export class NotionConfigError extends NotionAdapterError {
  constructor(message: string) {
    super("NOTION_CONFIG_ERROR", message);
  }
}

export class NotionApiError extends NotionAdapterError {
  constructor(
    code:
      | "NOTION_UNAUTHORIZED"
      | "NOTION_RESTRICTED_RESOURCE"
      | "NOTION_OBJECT_NOT_FOUND"
      | "NOTION_RATE_LIMITED"
      | "NOTION_API_ERROR"
      | "NOTION_NETWORK_ERROR",
    message: string,
    options: NotionErrorOptions = {},
  ) {
    super(code, message, options);
  }
}

export class NotionTimeoutError extends NotionAdapterError {
  constructor(cause?: unknown) {
    super("NOTION_TIMEOUT", "Notion request timed out", { cause });
  }
}

export class NotionSchemaError extends NotionAdapterError {
  constructor(message: string, cause?: unknown) {
    super("NOTION_SCHEMA_ERROR", message, { cause });
  }
}

export class NotionPropertyError extends NotionAdapterError {
  constructor(message: string) {
    super("NOTION_PROPERTY_ERROR", message);
  }
}

export class NotionValidationError extends NotionAdapterError {
  constructor(message: string) {
    super("NOTION_VALIDATION_ERROR", message);
  }
}

export class NotionDataSourceError extends NotionAdapterError {
  constructor(message: string) {
    super("NOTION_DATA_SOURCE_COUNT_ERROR", message);
  }
}

export class NotionPaginationError extends NotionAdapterError {
  constructor(message: string, cause?: unknown) {
    super("NOTION_ROW_LIMIT_ERROR", message, { cause });
  }
}

export class NotionRelationError extends NotionAdapterError {
  constructor(message: string) {
    super("NOTION_RELATION_ERROR", message);
  }
}
