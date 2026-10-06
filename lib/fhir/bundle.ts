// Searchset Bundle + paging links. Pure.
import type { FhirBundle, FhirResource } from "./types";

export const DEFAULT_COUNT = 20;
export const MAX_COUNT = 50;
export const MAX_OFFSET = 10_000;

export type Paging = { count: number; offset: number };

export type PagingResult =
  | { ok: true; paging: Paging }
  | { ok: false; error: string };

const INT = /^\d+$/;

/** `_count` is clamped to MAX_COUNT; non-integers and `_count=0` are rejected. */
export const parsePaging = (params: URLSearchParams): PagingResult => {
  const rawCount = params.get("_count");
  const rawOffset = params.get("_offset");

  let count = DEFAULT_COUNT;
  if (rawCount !== null) {
    if (!INT.test(rawCount) || Number(rawCount) < 1) {
      return { ok: false, error: "_count must be a positive integer." };
    }
    count = Math.min(Number(rawCount), MAX_COUNT);
  }

  let offset = 0;
  if (rawOffset !== null) {
    if (!INT.test(rawOffset) || Number(rawOffset) > MAX_OFFSET) {
      return {
        ok: false,
        error: `_offset must be an integer between 0 and ${MAX_OFFSET}.`,
      };
    }
    offset = Number(rawOffset);
  }
  return { ok: true, paging: { count, offset } };
};

const pageUrl = (
  baseUrl: string,
  path: string,
  params: URLSearchParams,
  paging: Paging,
) => {
  const next = new URLSearchParams();
  params.forEach((value, key) => {
    if (key !== "_count" && key !== "_offset") next.append(key, value);
  });
  next.set("_count", String(paging.count));
  next.set("_offset", String(paging.offset));
  return `${baseUrl}/${path}?${next.toString()}`;
};

/**
 * `resources` is the page already sliced for `paging`; `total` is the number
 * of matches across all pages.
 */
export const buildSearchBundle = ({
  baseUrl,
  path,
  params,
  paging,
  resources,
  total,
}: {
  baseUrl: string;
  path: string;
  params: URLSearchParams;
  paging: Paging;
  resources: FhirResource[];
  total: number;
}): FhirBundle => {
  const link = [
    { relation: "self", url: pageUrl(baseUrl, path, params, paging) },
  ];
  if (paging.offset > 0) {
    link.push({
      relation: "previous",
      url: pageUrl(baseUrl, path, params, {
        count: paging.count,
        offset: Math.max(0, paging.offset - paging.count),
      }),
    });
  }
  if (paging.offset + paging.count < total) {
    link.push({
      relation: "next",
      url: pageUrl(baseUrl, path, params, {
        count: paging.count,
        offset: paging.offset + paging.count,
      }),
    });
  }

  return {
    resourceType: "Bundle",
    type: "searchset",
    total,
    link,
    entry: resources.map((resource) => ({
      fullUrl: `${baseUrl}/${resource.resourceType}/${resource.id}`,
      resource,
      search: { mode: "match" as const },
    })),
  };
};
