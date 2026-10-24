import { afterEach, expect, it, vi } from "vitest";
import type { Document } from "@prisma/client";
import { config } from "../src/config.js";
import { s3, storageHealth, uploadFile, readFile, deleteFile, documentDto } from "../src/storage.js";

const original = config.STORAGE_DRIVER;
afterEach(() => { config.STORAGE_DRIVER = original; vi.restoreAllMocks(); });
it("runs without an S3 service when server file storage is explicitly disabled", async () => {
  config.STORAGE_DRIVER = "disabled";
  const send = vi.spyOn(s3, "send").mockImplementation(() => Promise.reject(new Error("Unexpected S3 request")));
  await expect(storageHealth()).resolves.toEqual({ status: "disabled" });
  expect(send).not.toHaveBeenCalled();
});
it("returns a clear service error instead of uploading or signing disabled documents", async () => {
  config.STORAGE_DRIVER = "disabled";
  const send = vi.spyOn(s3, "send").mockImplementation(() => Promise.reject(new Error("Unexpected S3 request")));
  for (const request of [
    () => uploadFile("document", Buffer.from("study"), "text/plain"),
    () => readFile("document"),
    () => deleteFile("document"),
    () => documentDto({ id: "document" } as Document),
  ]) await expect(request()).rejects.toMatchObject({ status: 503, kind: "document-storage-disabled" });
  expect(send).not.toHaveBeenCalled();
});
