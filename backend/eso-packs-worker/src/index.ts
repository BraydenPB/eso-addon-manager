import type { Env, Pack } from "./types";
import { getPack, getPackIndex, packToIndexItem, putPack, putPackIndex } from "./kv";
import { corsHeaders, handlePreflight } from "./cors";
import { validatePack } from "./validate";
import { SEED_PACKS } from "./seed";

function json(request: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(request),
    },
  });
}

function notFound(request: Request, message = "Not found"): Response {
  return json(request, { error: message }, 404);
}

function badRequest(request: Request, errors: unknown): Response {
  return json(request, { error: "Validation failed", details: errors }, 400);
}

function unauthorized(request: Request): Response {
  return json(request, { error: "Invalid or missing API key" }, 401);
}

function requireAuth(request: Request, env: Env): boolean {
  const key = request.headers.get("X-API-Key");
  return key === env.ADMIN_API_KEY;
}

// ── GET /packs ─────────────────────────────────────────────────────
async function handleListPacks(request: Request, env: Env, url: URL): Promise<Response> {
  const index = await getPackIndex(env);
  if (!index) {
    return json(request, { items: [] });
  }

  let items = index.items;

  const typeFilter = url.searchParams.get("type");
  if (typeFilter) {
    items = items.filter((p) => p.type === typeFilter);
  }

  const tagFilter = url.searchParams.get("tag");
  if (tagFilter) {
    items = items.filter((p) => p.tags.includes(tagFilter));
  }

  const query = url.searchParams.get("q")?.toLowerCase();
  if (query) {
    items = items.filter(
      (p) =>
        p.name.toLowerCase().includes(query) ||
        p.description.toLowerCase().includes(query),
    );
  }

  return json(request, { items });
}

// ── GET /packs/:id ─────────────────────────────────────────────────
async function handleGetPack(request: Request, env: Env, id: string): Promise<Response> {
  const pack = await getPack(env, id);
  if (!pack) {
    return notFound(request, `Pack "${id}" not found`);
  }
  return json(request, pack);
}

// ── POST /packs — create a new pack ────────────────────────────────
async function handleCreatePack(request: Request, env: Env): Promise<Response> {
  if (!requireAuth(request, env)) {
    return unauthorized(request);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(request, [{ field: "body", message: "Invalid JSON" }]);
  }

  const errors = validatePack(body);
  if (errors.length > 0) {
    return badRequest(request, errors);
  }

  const pack = body as Pack;

  // Check for ID conflict
  const existing = await getPack(env, pack.id);
  if (existing) {
    return json(request, { error: `Pack "${pack.id}" already exists. Use PUT to update.` }, 409);
  }

  // Stamp metadata timestamps
  const now = new Date().toISOString();
  pack.metadata.createdAt = now;
  pack.metadata.updatedAt = now;

  await putPack(env, pack);

  // Update index
  const index = (await getPackIndex(env)) ?? { items: [] };
  index.items.push(packToIndexItem(pack));
  await putPackIndex(env, index);

  return json(request, pack, 201);
}

// ── PUT /packs/:id — update an existing pack ───────────────────────
async function handleUpdatePack(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  if (!requireAuth(request, env)) {
    return unauthorized(request);
  }

  const existing = await getPack(env, id);
  if (!existing) {
    return notFound(request, `Pack "${id}" not found`);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return badRequest(request, [{ field: "body", message: "Invalid JSON" }]);
  }

  const errors = validatePack(body);
  if (errors.length > 0) {
    return badRequest(request, errors);
  }

  const pack = body as Pack;
  pack.id = id; // Enforce URL id
  pack.metadata.createdAt = existing.metadata.createdAt; // Preserve original
  pack.metadata.updatedAt = new Date().toISOString();
  pack.metadata.version = existing.metadata.version + 1;

  await putPack(env, pack);

  // Update index entry
  const index = (await getPackIndex(env)) ?? { items: [] };
  const idx = index.items.findIndex((item) => item.id === id);
  const indexItem = packToIndexItem(pack);
  if (idx >= 0) {
    index.items[idx] = indexItem;
  } else {
    index.items.push(indexItem);
  }
  await putPackIndex(env, index);

  return json(request, pack);
}

// ── DELETE /packs/:id ──────────────────────────────────────────────
async function handleDeletePack(
  request: Request,
  env: Env,
  id: string,
): Promise<Response> {
  if (!requireAuth(request, env)) {
    return unauthorized(request);
  }

  const existing = await getPack(env, id);
  if (!existing) {
    return notFound(request, `Pack "${id}" not found`);
  }

  await env.ESO_PACKS.delete(`pack:${id}`);

  // Remove from index
  const index = (await getPackIndex(env)) ?? { items: [] };
  index.items = index.items.filter((item) => item.id !== id);
  await putPackIndex(env, index);

  return json(request, { ok: true });
}

// ── POST /admin/seed (dev only) ────────────────────────────────────
async function handleSeed(request: Request, env: Env): Promise<Response> {
  const errors: string[] = [];

  for (const pack of SEED_PACKS) {
    const validationErrors = validatePack(pack);
    if (validationErrors.length > 0) {
      errors.push(`Pack "${pack.id}": ${JSON.stringify(validationErrors)}`);
      continue;
    }
    await putPack(env, pack);
  }

  const index = { items: SEED_PACKS.map(packToIndexItem) };
  await putPackIndex(env, index);

  return json(request, {
    ok: true,
    seeded: SEED_PACKS.length,
    errors,
  });
}

// ── Router ─────────────────────────────────────────────────────────
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS") {
      return handlePreflight(request);
    }

    // GET /packs
    if (method === "GET" && pathname === "/packs") {
      return handleListPacks(request, env, url);
    }

    // POST /packs — create
    if (method === "POST" && pathname === "/packs") {
      return handleCreatePack(request, env);
    }

    // /packs/:id routes
    if (pathname.startsWith("/packs/")) {
      const id = pathname.slice("/packs/".length);
      if (!id || id.includes("/")) {
        return notFound(request);
      }

      if (method === "GET") return handleGetPack(request, env, id);
      if (method === "PUT") return handleUpdatePack(request, env, id);
      if (method === "DELETE") return handleDeletePack(request, env, id);
    }

    // POST /admin/seed — temporary dev-only seeding route
    if (method === "POST" && pathname === "/admin/seed") {
      return handleSeed(request, env);
    }

    return notFound(request);
  },
} satisfies ExportedHandler<Env>;
