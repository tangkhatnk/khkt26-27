import { z } from "zod";

export const MAX_MATERIAL_BYTES = 32 * 1024 * 1024;
export const MAX_MATERIAL_BASE64_CHARS = 4 * Math.ceil(MAX_MATERIAL_BYTES / 3);
export const MAX_MATERIAL_PAGES = 20;
export const MAX_MATERIAL_TEXT_CHARS = 50_000;
export const MATERIAL_READ_BODY_LIMIT_BYTES = 45 * 1024 * 1024;

const materialMimeType = z.enum([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
]);
function isBase64(value: string) {
  if (value.length % 4 !== 0) return false;
  const paddingStart = value.indexOf("=");
  const dataEnd = paddingStart < 0 ? value.length : paddingStart;
  const paddingLength = value.length - dataEnd;
  if (paddingLength > 2 || (paddingLength > 0 && value.slice(dataEnd) !== "=".repeat(paddingLength)))
    return false;
  for (let index = 0; index < dataEnd; index++) {
    const code = value.charCodeAt(index);
    const valid = (code >= 65 && code <= 90) || (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) || code === 43 || code === 47;
    if (!valid) return false;
  }
  return dataEnd % 4 === 0 || (paddingLength === 2 && dataEnd % 4 === 2) ||
    (paddingLength === 1 && dataEnd % 4 === 3);
}

function decodedBase64Size(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length / 4 * 3 - padding;
}

function hasExpectedSignature(mimeType: z.infer<typeof materialMimeType>, data: string) {
  const prefix = Buffer.from(data.slice(0, 24), "base64");
  if (mimeType === "application/pdf") return prefix.subarray(0, 5).toString("ascii") === "%PDF-";
  if (mimeType === "image/png")
    return prefix.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mimeType === "image/jpeg")
    return prefix.length >= 3 && prefix[0] === 0xff && prefix[1] === 0xd8 && prefix[2] === 0xff;
  return prefix.length >= 12 && prefix.toString("ascii", 0, 4) === "RIFF" &&
    prefix.toString("ascii", 8, 12) === "WEBP";
}

export const materialReadRequestSchema = z.object({
  mimeType: materialMimeType,
  data: z.string().min(1).max(MAX_MATERIAL_BASE64_CHARS),
  recoverContext: z.boolean().default(false),
  context: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((value, context) => {
  if (value.data.length > MAX_MATERIAL_BASE64_CHARS) return;
  if (!isBase64(value.data)) {
    context.addIssue({
      code: "custom",
      path: ["data"],
      message: "Data must be base64 without a data URL prefix",
    });
    return;
  }
  if (decodedBase64Size(value.data) > MAX_MATERIAL_BYTES) {
    context.addIssue({
      code: "custom",
      path: ["data"],
      message: "Material file exceeds the 32 MiB limit",
    });
    return;
  }
  if (!hasExpectedSignature(value.mimeType, value.data))
    context.addIssue({
      code: "custom",
      path: ["data"],
      message: "File signature does not match mimeType",
    });
});

export type MaterialReadInput = z.input<typeof materialReadRequestSchema>;

export const materialReadResponseSchema = z.object({
  pages: z.array(z.object({
    pageNumber: z.number().int().min(1).max(MAX_MATERIAL_PAGES),
    text: z.string().max(MAX_MATERIAL_TEXT_CHARS * MAX_MATERIAL_PAGES),
  }).strict()).max(MAX_MATERIAL_PAGES),
  complete: z.boolean(),
}).strict();

export type MaterialReadProviderResponse = z.infer<typeof materialReadResponseSchema>;
