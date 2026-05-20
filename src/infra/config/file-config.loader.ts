import { Injectable } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import yaml from 'js-yaml';
import type { ConfigLoaderPort } from '../../application/ports/config-loader.port.js';

@Injectable()
export class FileConfigLoader implements ConfigLoaderPort {
  async load(path: string): Promise<unknown> {
    if (path.endsWith('.ts') || path.endsWith('.mjs') || path.endsWith('.js')) {
      const mod = await import(pathToFileURL(path).href);
      return mod.default ?? mod.config;
    }
    const text = await readFile(path, 'utf8');
    return path.endsWith('.yaml') || path.endsWith('.yml') ? yaml.load(text) : JSON.parse(text);
  }
}
