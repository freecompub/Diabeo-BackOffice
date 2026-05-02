import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3"
import { randomUUID } from "crypto"

const endpoint = process.env.OVH_S3_ENDPOINT
const bucket = process.env.OVH_S3_BUCKET
const accessKeyId = process.env.OVH_S3_ACCESS_KEY
const secretAccessKey = process.env.OVH_S3_SECRET_KEY
const region = process.env.OVH_S3_REGION ?? "gra"

function getClient(): S3Client {
  if (!endpoint || !accessKeyId || !secretAccessKey) {
    throw new Error("OVH S3 not configured — set OVH_S3_ENDPOINT, OVH_S3_ACCESS_KEY, OVH_S3_SECRET_KEY")
  }
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  })
}

function getBucket(): string {
  if (!bucket) throw new Error("OVH_S3_BUCKET not configured")
  return bucket
}

export function generateObjectKey(prefix: string, originalName: string): string {
  const ext = originalName.includes(".") ? originalName.slice(originalName.lastIndexOf(".")) : ""
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
    }),
  )
  return { key, size: body.length }
}

export async function downloadFile(key: string): Promise<{ body: ReadableStream; contentType: string }> {
  const client = getClient()
  const res = await client.send(
    new GetObjectCommand({ Bucket: getBucket(), Key: key }),
  )
  if (!res.Body) throw new Error("emptyResponse")
  return {
    body: res.Body.transformToWebStream(),
    contentType: res.ContentType ?? "application/octet-stream",
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
  } catch {
    return false
  }
}
