// Give every video its own presenter while keeping that presenter stable when the
// same video is regenerated. The title and script form a deterministic image seed.
export function presenterSeed(job = {}) {
  const key = String(job.title || "") + "\n" + String(job.script || "");
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return 100000 + ((hash >>> 0) % 900000000);
}
