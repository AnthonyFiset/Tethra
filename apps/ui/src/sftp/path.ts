export function parentPath(path: string): string {
  if (!path || path === "." || path === "/") {
    return path || ".";
  }
  const normalized = path.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) {
    return normalized.startsWith("/") ? "/" : ".";
  }
  return normalized.slice(0, index);
}

export function joinPath(parent: string, name: string): string {
  if (!parent || parent === ".") {
    return name;
  }
  if (parent.endsWith("/")) {
    return `${parent}${name}`;
  }
  return `${parent}/${name}`;
}

export function formatBytes(value: number | bigint | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  const bytes = Number(value);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

export function formatUnixTime(value: number | bigint | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return new Date(Number(value) * 1000).toLocaleString();
}
