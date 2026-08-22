export class NotionUnavailableError extends Error {
  readonly code = "NOTION_UNAVAILABLE";

  constructor(readonly reason: string) {
    super("Notion dashboard data is unavailable");
    this.name = "NotionUnavailableError";
  }
}
