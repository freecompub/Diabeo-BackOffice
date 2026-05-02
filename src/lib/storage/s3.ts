import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3"
import { randomUUID } from "crypto"

const MIME_TO_EXT: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}

let _client: S3Client | null = null

function getClient(): S3Client {
  if (_client) return _client
  const endpoint = process.env.OVH_S3_ENDPOINT
  const accessKeyId = process.env.OVH_S3_ACCESS_KEY
  const secretAccessKey = process.env.OVH_S3_SECRET_KEY
  const region = process.env.OVH_S3_REGION ?? "gra"
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("OVH S3 not configured — set OVH_S3_ENDPOINT, OVH_S3_ACCESS_KEY, OVH_S3_SECRET_KEY")
  }
  const isLocal = endpoint.includes("localhost") || endpoint.includes("127.0.0.1")
  _client = new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: isLocal,
  })
  return _client
}

function getBucket(): string {
  const bucket = process.env.OVH_S3_BUCKET
  if (!bucket) throw new Error("OVH_S3_BUCKET not configured")
  return bucket
}

export function generateObjectKey(prefix: string, mimeType: string): string {
  const ext = MIME_TO_EXT[mimeType] ?? ""
  return `${prefix}/${randomUUID()}${ext}`
}

export async function uploadFile(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<{ key: string; size: number }> {
  const client = getClient()
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: body,
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    }),
  )
  return { key, size: body.length }
}

export async function downloadFile(key: string): Promise<{ body: ReadableStream; contentType: string; contentLength: number | undefined }> {
  const client = getClient()
  const res = await client.send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
  )
  if (!res.Body) throw new Error("emptyResponse")
  return {
    body: res.Body.transformToWebStream(),
    contentType: res.ContentType ?? "application/octet-stream",
    contentLength: res.ContentLength,
  }
}

export async function deleteFile(key: string): Promise<void> {
  const client = getClient()
  await client.send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: key }),
  )
}

export async function fileExists(key: string): Promise<boolean> {
  try {
    const client = getClient()
    await client.send(new HeadObjectCommand({ Bucket: getBucket(), Key: key }))
    return true
  } catch (err: unknown) {
    const name = (err as { name?: string }).name
    if (name === "NotFound" || name === "NoSuchKey") return false
    throw err
  }
}
