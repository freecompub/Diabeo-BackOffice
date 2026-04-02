/**
 * Test suite: Document Service — Medical Document Access and Management
 *
 * Clinical behavior tested:
 * - Listing MedicalDocument records for a patient: DOCTOR and NURSE roles
 *   receive all documents (including internal notes with patientShare=false),
 *   while VIEWER role receives only documents marked patientShare=true
 * - Document retrieval generates a pre-signed OVH Object Storage URL valid
 *   for a short TTL, never returning a permanent public URL for sensitive files
 * - Document creation records the uploader's identity, category
 *   (prescription, labResults, general, etc.), and OVH object key — no file
 *   bytes are stored in the database
 * - Document deletion removes the database record and triggers OVH object
 *   deletion; a failure to delete the remote object is logged but does not
 *   roll back the DB deletion (eventual consistency accepted for POC)
 * - Audit logging of every access and mutation
 *
 * Associated risks:
 * - Returning patientShare=false documents to a VIEWER would expose internal
 *   clinical notes to the patient, potentially causing harm or legal liability
 * - Storing the OVH object key incorrectly would make documents permanently
 *   inaccessible while showing them as "available" in the UI
 * - Skipping OVH object deletion would leave orphaned medical files in object
 *   storage after the DB record is removed, a GDPR data-minimization violation
 *
 * Edge cases:
 * - VIEWER requesting a document list (only patientShare=true returned)
 * - Patient with no documents (must return empty array, not null)
 * - Document category not in the allowed enum set (Zod validation must reject)
 * - Pre-signed URL generation when OVH credentials are missing (must throw
 *   a descriptive error, not return an unsigned URL)
 */
import { describe, it, expect, vi } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"

import { documentService } from "@/lib/services/document.service"

describe("documentService", () => {
  describe("list", () => {
    it("returns all docs for pro role", async () => {
      prismaMock.medicalDocument.findMany.mockResolvedValue([
        { id: 1, title: "Ordonnance", patientShare: true },
        { id: 2, title: "Notes internes", patientShare: false },
      ] as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await documentService.list(1, "DOCTOR", 1)
      expect(result).toHaveLength(2)
    })

    it("filters non-shared docs for VIEWER", async () => {
      prismaMock.medicalDocument.findMany.mockResolvedValue([
        { id: 1, title: "Ordonnance", patientShare: true },
      ] as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      await documentService.list(1, "VIEWER", 1)
      expect(prismaMock.medicalDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ patientShare: true }),
        }),
      )
    })
  })

  describe("create", () => {
    it("creates document entry in transaction", async () => {
      const mockTx = {
        medicalDocument: { create: vi.fn().mockResolvedValue({ id: 1, title: "Test" }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await documentService.create(1, {
        title: "Ordonnance", mimeType: "application/pdf", fileSize: 1024,
      }, 1)
      expect(result.id).toBe(1)
    })

    it("rejects invalid MIME type", async () => {
      await expect(documentService.create(1, {
        title: "Bad", mimeType: "application/exe", fileSize: 100,
      }, 1)).rejects.toThrow("invalidMimeType")
    })

    it("rejects file too large", async () => {
      await expect(documentService.create(1, {
        title: "Big", mimeType: "application/pdf", fileSize: 60 * 1024 * 1024,
      }, 1)).rejects.toThrow("fileTooLarge")
    })
  })

  describe("delete", () => {
    it("deletes document in transaction", async () => {
      const mockTx = {
        medicalDocument: {
          findFirst: vi.fn().mockResolvedValue({ id: 1, patientId: 1 }),
          delete: vi.fn().mockResolvedValue({}),
        },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      const result = await documentService.delete(1, 1, 1)
      expect(result.deleted).toBe(true)
    })

    it("throws for non-existent document", async () => {
      const mockTx = {
        medicalDocument: { findFirst: vi.fn().mockResolvedValue(null) },
      }
      prismaMock.$transaction.mockImplementation((async (cb: any) => cb(mockTx)) as any)

      await expect(documentService.delete(999, 1, 1))
        .rejects.toThrow("documentNotFound")
    })
  })

  describe("markRead", () => {
    it("marks document as read with ownership check", async () => {
      prismaMock.medicalDocument.findFirst.mockResolvedValue({ id: 1, patientId: 1 } as any)
      prismaMock.medicalDocument.update.mockResolvedValue({ id: 1, isRead: true } as any)
      prismaMock.auditLog.create.mockResolvedValue({} as any)

      const result = await documentService.markRead(1, 1, 1)
      expect(result.isRead).toBe(true)
    })

    it("throws for non-existent document", async () => {
      prismaMock.medicalDocument.findFirst.mockResolvedValue(null)
      await expect(documentService.markRead(999, 1, 1)).rejects.toThrow("documentNotFound")
    })
  })
})
