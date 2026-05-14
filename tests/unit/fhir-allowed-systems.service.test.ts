/**
 * Test suite: fhir-allowed-systems.service (US-2123 H5)
 *
 * Covers:
 *  - Origin normalization (lowercase, no path)
 *  - SSRF guards (localhost, RFC1918, link-local, GCP metadata)
 *  - HTTPS enforcement
 *  - Audit on every CRUD with resource = FHIR_ALLOWED_SYSTEM
 *  - P2002 → ValidationError("alreadyExists")
 */
import { Prisma } from "@prisma/client"
import { describe, it, expect, beforeEach } from "vitest"
import { prismaMock } from "../helpers/prisma-mock"
import {
  fhirAllowedSystemService,
  normalizeAndValidateOrigin,
} from "@/lib/services/fhir-allowed-systems.service"
import {
  NotFoundError,
  ValidationError,
} from "@/lib/services/team-workflow.errors"

beforeEach(() => {
  prismaMock.auditLog.create.mockResolvedValue({} as any)
  prismaMock.$transaction.mockImplementation(async (fn: any) => fn(prismaMock))
})

describe("normalizeAndValidateOrigin", () => {
  it("lowercases hostname + strips path", () => {
    expect(normalizeAndValidateOrigin("https://FHIR-Server.Example.com/"))
      .toBe("https://fhir-server.example.com")
  })
  it("rejects http (must be https)", () => {
    expect(() => normalizeAndValidateOrigin("http://fhir.example.com/")).toThrow(ValidationError)
  })
  it("rejects malformed URLs", () => {
    expect(() => normalizeAndValidateOrigin("not-a-url")).toThrow(ValidationError)
  })
  it("rejects path-bearing origins", () => {
    expect(() => normalizeAndValidateOrigin("https://fhir.example.com/Patient"))
      .toThrow(ValidationError)
  })
  it("rejects localhost (SSRF guard)", () => {
    expect(() => normalizeAndValidateOrigin("https://localhost/")).toThrow(ValidationError)
  })
  it("rejects loopback IPv4 (SSRF guard)", () => {
    expect(() => normalizeAndValidateOrigin("https://127.0.0.1/")).toThrow(ValidationError)
  })
  it("rejects RFC1918 10.x (SSRF guard)", () => {
    expect(() => normalizeAndValidateOrigin("https://10.0.0.5/")).toThrow(ValidationError)
  })
  it("rejects RFC1918 192.168.x (SSRF guard)", () => {
    expect(() => normalizeAndValidateOrigin("https://192.168.1.1/")).toThrow(ValidationError)
  })
  it("rejects link-local 169.254 (cloud metadata SSRF)", () => {
    expect(() => normalizeAndValidateOrigin("https://169.254.169.254/")).toThrow(ValidationError)
  })
  it("rejects GCP metadata host", () => {
    expect(() => normalizeAndValidateOrigin("https://metadata.google.internal/")).toThrow(ValidationError)
  })
  it("accepts a public https origin", () => {
    expect(normalizeAndValidateOrigin("https://dmp.gouv.fr/"))
      .toBe("https://dmp.gouv.fr")
  })
})

describe("fhirAllowedSystemService.create", () => {
  it("rejects empty label", async () => {
    await expect(
      fhirAllowedSystemService.create(
        { origin: "https://dmp.gouv.fr/", label: "", dpaReference: "DPA-001" }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("rejects empty dpaReference", async () => {
    await expect(
      fhirAllowedSystemService.create(
        { origin: "https://dmp.gouv.fr/", label: "DMP", dpaReference: "" }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
  it("happy path + audits with resource = FHIR_ALLOWED_SYSTEM", async () => {
    prismaMock.fhirAllowedSystem.create.mockResolvedValue({
      id: 1, origin: "https://dmp.gouv.fr", label: "DMP",
      dpaReference: "DPA-001", isActive: true, killSwitchActive: false,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await fhirAllowedSystemService.create(
      { origin: "https://DMP.gouv.fr/", label: "DMP", dpaReference: "DPA-001" }, 9,
    )
    expect(out.origin).toBe("https://dmp.gouv.fr")
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.resource).toBe("FHIR_ALLOWED_SYSTEM")
  })
  it("maps P2002 to ValidationError(alreadyExists)", async () => {
    const err = new Prisma.PrismaClientKnownRequestError(
      "unique violation", { code: "P2002", clientVersion: "7.6.0", meta: {} },
    )
    prismaMock.fhirAllowedSystem.create.mockRejectedValueOnce(err)
    await expect(
      fhirAllowedSystemService.create(
        { origin: "https://dmp.gouv.fr/", label: "DMP", dpaReference: "DPA-001" }, 9,
      ),
    ).rejects.toBeInstanceOf(ValidationError)
  })
})

describe("fhirAllowedSystemService.update + delete", () => {
  it("update throws NotFoundError when id missing", async () => {
    prismaMock.fhirAllowedSystem.findUnique.mockResolvedValue(null)
    await expect(
      fhirAllowedSystemService.update(999, { isActive: false }, 9),
    ).rejects.toBeInstanceOf(NotFoundError)
  })
  it("toggles kill-switch + audits", async () => {
    prismaMock.fhirAllowedSystem.findUnique.mockResolvedValue({
      id: 1, origin: "https://dmp.gouv.fr",
    } as any)
    prismaMock.fhirAllowedSystem.update.mockResolvedValue({
      id: 1, origin: "https://dmp.gouv.fr", label: "DMP",
      dpaReference: "DPA-001", isActive: true, killSwitchActive: true,
      createdAt: new Date(), updatedAt: new Date(),
    } as any)
    const out = await fhirAllowedSystemService.update(1, { killSwitchActive: true }, 9)
    expect(out.killSwitchActive).toBe(true)
    const audit = prismaMock.auditLog.create.mock.calls.at(-1)![0].data as any
    expect(audit.metadata.updatedFields).toContain("killSwitchActive")
  })
  it("delete throws NotFoundError when id missing", async () => {
    prismaMock.fhirAllowedSystem.findUnique.mockResolvedValue(null)
    await expect(fhirAllowedSystemService.deleteById(999, 9))
      .rejects.toBeInstanceOf(NotFoundError)
  })
})
