import { PrismaClient, Role, DiabetesType } from "@prisma/client"

const prisma = new PrismaClient()

async function main() {
  // Utilisateurs de test — mots de passe fictifs, jamais de vraies données
  const admin = await prisma.user.upsert({
    where: { email: "admin@diabeo.test" },
    update: {},
    create: {
      email: "admin@diabeo.test",
      name: "Admin Test",
      passwordHash: "$2b$10$placeholder_hash_never_real",
      role: Role.ADMIN,
    },
  })

  const doctor = await prisma.user.upsert({
    where: { email: "docteur@diabeo.test" },
    update: {},
    create: {
      email: "docteur@diabeo.test",
      name: "Dr. Martin Test",
      passwordHash: "$2b$10$placeholder_hash_never_real",
      role: Role.DOCTOR,
    },
  })

  const nurse = await prisma.user.upsert({
    where: { email: "infirmiere@diabeo.test" },
    update: {},
    create: {
      email: "infirmiere@diabeo.test",
      name: "Infirmière Test",
      passwordHash: "$2b$10$placeholder_hash_never_real",
      role: Role.NURSE,
    },
  })

  console.log("Seed: users created", { admin: admin.id, doctor: doctor.id, nurse: nurse.id })
}

main()
  .then(() => prisma.$disconnect())
  .catch((e) => {
    console.error(e)
    prisma.$disconnect()
    process.exit(1)
  })
