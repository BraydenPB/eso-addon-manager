import type { Env, Pack, PackIndex, PackIndexItem } from "./types";

const PACK_PREFIX = "pack:";
const INDEX_KEY = "index:packs";

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
    updatedAt: pack.metadata.updatedAt,
  };
}
