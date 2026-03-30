import type { Env, SharePackData, ShareRecord, ShareCodeResponse, ValidationError } from "./types";
import { corsHeaders } from "./cors";

// Unambiguous alphabet: no 0/O, 1/I/L
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const CODE_LENGTH = 6;
const CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{6}$/;
const SHARE_TTL = 604800; // 7 days in seconds
const MAX_SHARES_PER_USER = 10;
const MAX_ADDONS = 200;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
const VALID_TYPES = ["addon-pack", "build-pack", "roster-pack"];

const ESO_LOGS_API = "https://www.esologs.com/api/v2/user";

// ── Helpers ───────────────────────────────────────────────────────

function json(
  request: Request,
  data: unknown,
  status = 200,
  cacheMaxAge = 0,
  cacheScope: "public" | "private" = "private",
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...corsHeaders(request),
  };
  if (cacheMaxAge > 0) {
    headers["Cache-Control"] = `${cacheScope}, max-age=${cacheMaxAge}`;
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function generateCode(): string {
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

function shareKey(code: string): string {
  return `share:${code}`;
}

function userShareKey(userId: string, code: string): string {
  return `share-user:${userId}:${code}`;
}

// ── Auth ──────────────────────────────────────────────────────────

interface EsoLogsUser {
  id: number;
  name: string;
}

async function validateBearerToken(request: Request): Promise<EsoLogsUser | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);
  try {
    const res = await fetch(ESO_LOGS_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: "{ userData { currentUser { id name } } }",
      }),
    });

    if (!res.ok) return null;

    const body = (await res.json()) as {
      data?: { userData?: { currentUser?: EsoLogsUser } };
    };
    return body.data?.userData?.currentUser ?? null;
  } catch {
    return null;
  }
}

// ── Validation ───────────────────────────────────────────────────

function validateSharePayload(data: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!data || typeof data !== "object") {
    return [{ field: "body", message: "Body must be a JSON object" }];
  }

  const d = data as Record<string, unknown>;

  if (typeof d.title !== "string" || d.title.length === 0 || d.title.length > MAX_NAME_LENGTH) {
    errors.push({ field: "title", message: `title is required and must be 1-${MAX_NAME_LENGTH} characters` });
  }

  if (typeof d.description !== "string" || d.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push({ field: "description", message: `description must be a string under ${MAX_DESCRIPTION_LENGTH} characters` });
  }

  if (typeof d.packType !== "string" || !VALID_TYPES.includes(d.packType)) {
    errors.push({ field: "packType", message: `packType must be one of: ${VALID_TYPES.join(", ")}` });
  }

  if (!Array.isArray(d.tags)) {
    errors.push({ field: "tags", message: "tags must be an array" });
  }

  if (!Array.isArray(d.addons) || d.addons.length === 0 || d.addons.length > MAX_ADDONS) {
    errors.push({ field: "addons", message: `addons must be an array with 1-${MAX_ADDONS} entries` });
  } else {
    for (let i = 0; i < d.addons.length; i++) {
      const addon = d.addons[i] as Record<string, unknown>;
      if (typeof addon.esouiId !== "number" || addon.esouiId <= 0) {
        errors.push({ field: `addons[${i}].esouiId`, message: "esouiId must be a positive number" });
      }
      if (typeof addon.name !== "string" || addon.name.length === 0) {
        errors.push({ field: `addons[${i}].name`, message: "name is required" });
      }
    }
  }

  return errors;
}

// ── Handlers ─────────────────────────────────────────────────────

export async function handleCreateShare(request: Request, env: Env): Promise<Response> {
  // Validate Bearer token
  const user = await validateBearerToken(request);
  if (!user) {
    return json(request, { error: "Invalid or missing authorization token" }, 401);
  }

  const userId = String(user.id);

  // Rate limit: max active shares per user
  const userKeys = await env.ESO_PACKS.list({ prefix: `share-user:${userId}:` });
  if (userKeys.keys.length >= MAX_SHARES_PER_USER) {
    return json(
      request,
      { error: `Maximum of ${MAX_SHARES_PER_USER} active share codes reached. Wait for existing codes to expire.` },
      429,
    );
  }

  // Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json(request, { error: "Invalid JSON" }, 400);
  }

  const errors = validateSharePayload(body);
  if (errors.length > 0) {
    return json(request, { error: "Validation failed", details: errors }, 400);
  }

  const packData = body as SharePackData;

  // Generate unique code (retry on collision)
  let code = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    const candidate = generateCode();
    const existing = await env.ESO_PACKS.get(shareKey(candidate));
    if (!existing) {
      code = candidate;
      break;
    }
  }

  if (!code) {
    return json(request, { error: "Failed to generate unique share code. Please try again." }, 500);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SHARE_TTL * 1000).toISOString();

  const record: ShareRecord = {
    code,
    pack: packData,
    createdBy: userId,
    createdByName: user.name,
    createdAt: now.toISOString(),
    expiresAt,
  };

  // Store share record with TTL
  await env.ESO_PACKS.put(shareKey(code), JSON.stringify(record), {
    expirationTtl: SHARE_TTL,
  });

  // Store user tracking key with same TTL
  await env.ESO_PACKS.put(userShareKey(userId, code), "1", {
    expirationTtl: SHARE_TTL,
  });

  const response: ShareCodeResponse = {
    code,
    expiresAt,
    deepLink: `kalpa://share/${code}`,
  };

  return json(request, response, 201);
}

export async function handleResolveShare(request: Request, env: Env, code: string): Promise<Response> {
  // Validate code format
  if (!CODE_PATTERN.test(code)) {
    return json(request, { error: "Invalid share code format" }, 400);
  }

  const record = await env.ESO_PACKS.get<ShareRecord>(shareKey(code), "json");
  if (!record) {
    return json(request, { error: "Share code not found or expired" }, 404);
  }

  // Share data is immutable — cache at CDN edge for 5 minutes
  return json(request, {
    pack: record.pack,
    sharedBy: record.createdByName,
    sharedAt: record.createdAt,
    expiresAt: record.expiresAt,
  }, 200, 300);
}
