// Copyright (c) 2026 Sub Rosa contributors
// HTTP client with content-type validation for Drand responses.

import {
  Chain,
  ChainClient,
  ChainOptions,
  defaultChainOptions,
  RandomnessBeacon,
  HttpCachingChain,
} from "drand-client";
import { systemClock } from "@sub-rosa/time";

const JSON_CONTENT_TYPE = "application/json";

export interface HttpOptions {
  userAgent?: string;
  headers?: Record<string, string>;
}

export const defaultHttpOptions: HttpOptions = {
  userAgent: `sub-rosa-tlock/0.1.0`,
};

function parseMediaType(contentType: string): { type: string; charset?: string } {
  const parts = contentType.split(";").map((p) => p.trim().toLowerCase());
  const type = parts[0];
  const charset = parts.find((p) => p.startsWith("charset="))?.split("=")[1];
  return { type, charset };
}

export function validateContentType(contentType: string | null): void {
  if (contentType === null || contentType === undefined) {
    throw new Error("Missing Content-Type header in Drand response");
  }
  const { type } = parseMediaType(contentType);
  if (type !== JSON_CONTENT_TYPE) {
    throw new Error(`Unexpected Content-Type: expected ${JSON_CONTENT_TYPE}, got ${type}`);
  }
}

export interface ValidatingHttpOptions extends HttpOptions {
  validateContentType?: (contentType: string | null) => void;
}

export class ValidatingHttpChainClient implements ChainClient {
  public readonly options: ChainOptions;

  constructor(
    private readonly chainInstance: Chain,
    options: ChainOptions = defaultChainOptions,
    private readonly httpOptions: ValidatingHttpOptions = defaultHttpOptions,
  ) {
    this.options = options;
  }

  async get(roundNumber: number): Promise<RandomnessBeacon> {
    const url = this.withCachingParams(`${this.chainInstance.baseUrl}/public/${roundNumber}`);
    return await this.jsonOrError(url);
  }

  async latest(): Promise<RandomnessBeacon> {
    const url = this.withCachingParams(`${this.chainInstance.baseUrl}/public/latest`);
    return await this.jsonOrError(url);
  }

  chain(): Chain {
    return this.chainInstance;
  }

  private withCachingParams(url: string): string {
    if (this.options.noCache) {
      return `${url}?${systemClock.nowMs()}`;
    }
    return url;
  }

  private async jsonOrError(url: string): Promise<RandomnessBeacon> {
    const headers = { ...this.httpOptions.headers };
    if (this.httpOptions.userAgent) {
      headers["User-Agent"] = this.httpOptions.userAgent;
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`Error response fetching ${url} - got ${response.status}`);
    }

    const contentType = response.headers.get("content-type");
    const validator = this.httpOptions.validateContentType ?? validateContentType;
    validator(contentType);

    return await response.json();
  }
}

const QUICKNET_CHAIN_URL = "https://api.drand.sh/52db9ba70e0cc0f6eaf7803dd07447a1f5477735fd3f661792ba94600c84e971";

export function createValidatingQuicknetClient(options?: ChainOptions): ChainClient {
  const chain = new HttpCachingChain(QUICKNET_CHAIN_URL, options ?? defaultChainOptions);
  return new ValidatingHttpChainClient(chain, options ?? defaultChainOptions);
}