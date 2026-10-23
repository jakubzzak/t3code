import type { ProjectEntry } from "@t3tools/contracts";

// Pierre owns the virtualized row markup. Annotate only mounted rows, and update
// when it recycles them; no per-path CSS or observers for offscreen entries.
export function annotateFileLinks(root: ShadowRoot, entries: readonly ProjectEntry[]) {
  const links = new Map(
    entries.filter((entry) => entry.link).map((entry) => [entry.path, entry.link!]),
  );
  for (const row of root.querySelectorAll<HTMLElement>("[data-item-path][role=treeitem]")) {
    const link = links.get(row.dataset.itemPath?.replace(/\/$/, "") ?? "");
    if (link) {
      row.dataset.symbolicLink = link.unavailable ? "unavailable" : "available";
      row.title = link.target;
      row.setAttribute(
        "aria-description",
        `Symbolic link${link.unavailable ? ", target unavailable" : ""}: ${link.target}`,
      );
    } else if (row.hasAttribute("data-symbolic-link")) {
      row.removeAttribute("data-symbolic-link");
      row.removeAttribute("title");
      row.removeAttribute("aria-description");
    }
  }
}

export const FILE_LINK_CSS = `
[data-symbolic-link] [data-item-section="icon"] { position: relative; }
[data-symbolic-link] [data-item-section="icon"]::after {
  content: "";
  position: absolute;
  right: -3px;
  bottom: -2px;
  width: 10px;
  height: 10px;
  background: var(--trees-fg);
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='none' stroke='black' stroke-width='3' stroke-linecap='round' stroke-linejoin='round' d='M4 20v-8a4 4 0 0 1 4-4h12m-5-5 5 5-5 5'/%3E%3C/svg%3E") center / contain no-repeat;
}
`;
