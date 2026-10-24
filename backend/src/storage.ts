import {
  localUpload,
  localRead,
  localDelete,
  localHealth,
  localUrl,
} from "./localStorage.js";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { Document } from "@prisma/client";
import { config } from "./config.js";
import { ApiError } from "./errors.js";
export const s3 = new S3Client({
  region: config.S3_REGION,
  endpoint: config.S3_ENDPOINT,
  forcePathStyle: !!config.S3_ENDPOINT,
  credentials:
    config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: config.S3_ACCESS_KEY_ID,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
});
const signingClient = config.S3_PUBLIC_ENDPOINT
  ? new S3Client({
      region: config.S3_REGION,
      endpoint: config.S3_PUBLIC_ENDPOINT,
      forcePathStyle: true,
      credentials:
        config.S3_ACCESS_KEY_ID && config.S3_SECRET_ACCESS_KEY
          ? {
              accessKeyId: config.S3_ACCESS_KEY_ID,
              secretAccessKey: config.S3_SECRET_ACCESS_KEY,
            }
          : undefined,
    })
  : s3;
const disabledStorageError = () => new ApiError(503, "document-storage-disabled",
  "Máy chủ chưa bật lưu tệp. Bạn vẫn có thể nhập tài liệu trực tiếp trên web để tạo quiz.");
export const uploadFile = async (key: string, body: Buffer, mime: string) => {
  if (config.STORAGE_DRIVER === "disabled") throw disabledStorageError();
  return config.STORAGE_DRIVER === "local"
    ? localUpload(key, body)
    : s3.send(
        new PutObjectCommand({
          Bucket: config.S3_BUCKET,
          Key: key,
          Body: body,
          ContentType: mime,
        }),
      );
};
export const deleteFile = async (key: string) => {
  if (config.STORAGE_DRIVER === "disabled") throw disabledStorageError();
  return config.STORAGE_DRIVER === "local"
    ? localDelete(key)
    : s3.send(new DeleteObjectCommand({ Bucket: config.S3_BUCKET, Key: key }));
};
export const storageHealth = async () => {
  if (config.STORAGE_DRIVER === "disabled") return { status: "disabled" };
  return config.STORAGE_DRIVER === "local"
    ? localHealth()
    : s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
};
export async function documentDto(doc: Document) {
  if (config.STORAGE_DRIVER === "disabled") throw disabledStorageError();
  const url =
    config.STORAGE_DRIVER === "local"
      ? localUrl(doc.id)
      : await getSignedUrl(
          signingClient,
          new GetObjectCommand({
            Bucket: config.S3_BUCKET,
            Key: doc.storage_key,
          }),
          { expiresIn: 3600 },
        );
  return {
    id: doc.id,
    name: doc.name,
    url,
    thumbnail_url: doc.mime_type.startsWith("image/") ? url : null,
    size_bytes: doc.size_bytes,
    mime_type: doc.mime_type,
    created_at: doc.created_at,
  };
}
export async function readFile(key: string) {
  if (config.STORAGE_DRIVER === "disabled") throw disabledStorageError();
  if (config.STORAGE_DRIVER === "local") return localRead(key);
  const result = await s3.send(
    new GetObjectCommand({ Bucket: config.S3_BUCKET, Key: key }),
  );
  if (!result.Body) throw new Error("Object missing");
  return Buffer.from(await result.Body.transformToByteArray());
}
export function matchesMime(body: Buffer, mime: string) {
  if (mime === "application/pdf")
    return body.subarray(0, 5).toString() === "%PDF-";
  if (mime === "image/png")
    return body
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg")
    return body[0] === 255 && body[1] === 216 && body[2] === 255;
  if (mime === "image/webp")
    return (
      body.subarray(0, 4).toString() === "RIFF" &&
      body.subarray(8, 12).toString() === "WEBP"
    );
  return !body.includes(0);
}
