import type { Pack, ValidationError } from "./types";

const VALID_TYPES = ["addon-pack", "build-pack", "roster-pack"];
const ID_PATTERN = /^[a-z0-9-]+$/;
const MAX_NAME_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_TAGS = 10;
const MAX_ADDONS = 200;

export function validatePack(pack: unknown): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!pack || typeof pack !== "object") {
    return [{ field: "pack", message: "Pack must be a JSON object" }];
  }

  const p = pack as Record<string, unknown>;

  if (typeof p.id !== "string" || !ID_PATTERN.test(p.id)) {
    errors.push({
      field: "id",
      message:
        "id is required and must contain only lowercase letters, numbers, and hyphens",
    });
  }

  if (
    typeof p.name !== "string" ||
    p.name.length === 0 ||
    p.name.length > MAX_NAME_LENGTH
  ) {
    errors.push({
      field: "name",
      message: `name is required and must be 1-${MAX_NAME_LENGTH} characters`,
    });
  }

  if (
    typeof p.description !== "string" ||
    p.description.length > MAX_DESCRIPTION_LENGTH
  ) {
    errors.push({
      field: "description",
      message: `description must be a string under ${MAX_DESCRIPTION_LENGTH} characters`,
    });
  }

  if (typeof p.type !== "string" || !VALID_TYPES.includes(p.type)) {
    errors.push({
      field: "type",
      message: `type must be one of: ${VALID_TYPES.join(", ")}`,
    });
  }

  if (!Array.isArray(p.tags) || p.tags.length > MAX_TAGS) {
    errors.push({
      field: "tags",
      message: `tags must be an array with at most ${MAX_TAGS} entries`,
    });
  }

  if (!Array.isArray(p.addons) || p.addons.length > MAX_ADDONS) {
    errors.push({
      field: "addons",
      message: `addons must be an array with at most ${MAX_ADDONS} entries`,
    });
  } else {
    for (let i = 0; i < p.addons.length; i++) {
      const addon = p.addons[i] as Record<string, unknown>;
      if (typeof addon.esouiId !== "number" || addon.esouiId <= 0) {
        errors.push({
          field: `addons[${i}].esouiId`,
          message: "esouiId must be a positive number",
        });
      }
      if (typeof addon.name !== "string" || addon.name.length === 0) {
        errors.push({
          field: `addons[${i}].name`,
          message: "name is required",
        });
      }
    }
  }

  if (!p.metadata || typeof p.metadata !== "object") {
    errors.push({ field: "metadata", message: "metadata is required" });
  } else {
    const m = p.metadata as Record<string, unknown>;
    if (typeof m.createdBy !== "string" || m.createdBy.length === 0) {
      errors.push({
        field: "metadata.createdBy",
        message: "createdBy is required",
      });
    }
  }

  return errors;
}
