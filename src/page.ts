export const PAGE_URL = "http://leanagent.localhost:8770";

export interface Host {
  showInformationMessage(message: string, ...items: string[]): PromiseLike<string | undefined>;
  openExternal(url: string): PromiseLike<unknown>;
}

export async function openPage(host: Host): Promise<void> {
  await host.openExternal(PAGE_URL);
}
