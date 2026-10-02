import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useMemo } from "react";
import { create } from "zustand";

const DEFAULT_REGEX = String.raw`^(?!.*\.(spec|test)\.).*$`;
const DEFAULT_FILTER = {
  source: DEFAULT_REGEX,
  appliedSource: DEFAULT_REGEX,
  message: null as string | null,
  invalid: false,
  pending: null as AbortController | null,
};

type FileFilter = typeof DEFAULT_FILTER;

function editFilter(current: FileFilter, source: string): FileFilter {
  try {
    if (source.length > 2000) throw new Error("Use at most 2,000 characters.");
    RegExp(source);
    return { ...current, source, appliedSource: source, message: null, invalid: false };
  } catch (error) {
    return {
      ...current,
      source,
      invalid: true,
      message: error instanceof Error ? error.message : "Invalid regular expression.",
    };
  }
}

/** View preferences last for this client session and never become defaults for another chat. */
export const useFileFilterStore = create<{
  filters: Record<string, FileFilter>;
  edit: (key: string, source: string) => void;
  begin: (key: string) => AbortController;
  finish: (
    key: string,
    request: AbortController,
    result: { regex: string } | { error: string },
  ) => void;
  cancel: (key: string, request: AbortController) => void;
}>((set, get) => ({
  filters: {},
  edit: (key, source) =>
    set((state) => {
      const current = state.filters[key] ?? DEFAULT_FILTER;
      if (current.pending) return state;
      return { filters: { ...state.filters, [key]: editFilter(current, source) } };
    }),
  begin: (key) => {
    get().filters[key]?.pending?.abort();
    const request = new AbortController();
    set((state) => ({
      filters: {
        ...state.filters,
        [key]: {
          ...(state.filters[key] ?? DEFAULT_FILTER),
          pending: request,
          message: null,
        },
      },
    }));
    return request;
  },
  finish: (key, request, result) =>
    set((state) => {
      const current = state.filters[key];
      if (!current || current.pending !== request || request.signal.aborted) return state;
      const next =
        "regex" in result
          ? editFilter(current, result.regex)
          : { ...current, message: result.error };
      return { filters: { ...state.filters, [key]: { ...next, pending: null } } };
    }),
  cancel: (key, request) => {
    request.abort();
    set((state) => {
      const current = state.filters[key];
      if (current?.pending !== request) return state;
      return {
        filters: {
          ...state.filters,
          [key]: { ...current, pending: null, message: "Generation stopped." },
        },
      };
    });
  },
}));

export function fileFilterKey(ref: ScopedThreadRef, view: "diff" | "pull-request") {
  return `${scopedThreadKey(ref)}:${view}`;
}

export function selectFileFilter(filters: Record<string, FileFilter>, key: string) {
  return filters[key] ?? DEFAULT_FILTER;
}

export function useFileFilterState(key: string) {
  return useFileFilterStore((state) => selectFileFilter(state.filters, key));
}

export function useFileFilter(key: string) {
  const source = useFileFilterStore((state) => state.filters[key]?.appliedSource ?? DEFAULT_REGEX);
  return useMemo(() => createFileFilter(source), [source]);
}

export function createFileFilter(source: string) {
  const regex = new RegExp(source);
  return {
    active: source !== "",
    matchesPath: (path: string) => regex.test(path.slice(path.lastIndexOf("/") + 1)),
  };
}
