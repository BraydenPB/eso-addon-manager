import type { Env, Pack, PackIndex, PackIndexItem, VoteRecord } from "./types";

const PACK_PREFIX = "pack:";
const INDEX_KEY = "index:packs";
const VOTE_PREFIX = "vote:";

export async function getPackIndex(env: Env): Promise<PackIndex | null> {
  return env.ESO_PACKS.get<PackIndex>(INDEX_KEY, "json");
}

export async function getPack(env: Env, id: string): Promise<Pack | null> {
  return env.ESO_PACKS.get<Pack>(`${PACK_PREFIX}${id}`, "json");
}

export async function putPack(env: Env, pack: Pack): Promise<void> {
  await env.ESO_PACKS.put(`${PACK_PREFIX}${pack.id}`, JSON.stringify(pack));
}

export async function putPackIndex(
  env: Env,
  index: PackIndex,
): Promise<void> {
  await env.ESO_PACKS.put(INDEX_KEY, JSON.stringify(index));
}

export function packToIndexItem(pack: Pack): PackIndexItem {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    type: pack.type,
    tags: pack.tags,
    addonCount: pack.addons.length,
    buildCount: pack.builds?.length ?? 0,
    rosterCount: pack.rosters?.length ?? 0,
    voteCount: pack.voteCount ?? 0,
    updatedAt: pack.metadata.updatedAt,
  };
}

// ── Vote helpers ──────────────────────────────────────────────────

function voteKey(packId: string, userId: string): string {
  return `${VOTE_PREFIX}${packId}:${userId}`;
}

export async function getVote(
  env: Env,
  packId: string,
  userId: string,
): Promise<VoteRecord | null> {
  return env.ESO_PACKS.get<VoteRecord>(voteKey(packId, userId), "json");
}

export async function putVote(
  env: Env,
  packId: string,
  userId: string,
): Promise<void> {
  const record: VoteRecord = {
    userId,
    packId,
    votedAt: new Date().toISOString(),
  };
  await env.ESO_PACKS.put(voteKey(packId, userId), JSON.stringify(record));
}

export async function deleteVote(
  env: Env,
  packId: string,
  userId: string,
): Promise<void> {
  await env.ESO_PACKS.delete(voteKey(packId, userId));
}
