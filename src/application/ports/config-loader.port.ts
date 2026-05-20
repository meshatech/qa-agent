export interface ConfigLoaderPort {
  load(path: string): Promise<unknown>;
}
