import fs from "fs";
import path from "path";
import jwt from "jsonwebtoken";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const dryRun = process.argv.includes("--dry-run");

async function main() {
  if (!process.env.FILE_PATH || !process.env.JWT_SECRET) {
    throw new Error("FILE_PATH and JWT_SECRET must be configured");
  }

  const invoiceDirectory = path.join(process.env.FILE_PATH, "invoice");
  fs.mkdirSync(invoiceDirectory, { recursive: true });
  const legacyFiles = fs.readdirSync(invoiceDirectory).filter((name) =>
    /^performa-invoice\d+\.pdf(?:\.version)?$/.test(name)
  );
  const approvedOrders = await prisma.order.findMany({
    where: { approved: true },
    select: { id: true },
    orderBy: { id: "asc" },
  });

  console.log(`Legacy invoice files: ${legacyFiles.length}`);
  console.log(`Approved orders to regenerate: ${approvedOrders.length}`);
  if (dryRun) return;

  const admin = await prisma.user.findFirst({
    where: { status: true, role: { name: "admin" } },
    select: { id: true, name: true, email: true },
  });
  if (!admin) throw new Error("No active admin account is available for invoice regeneration");

  for (const name of legacyFiles) fs.unlinkSync(path.join(invoiceDirectory, name));

  const token = jwt.sign(
    { userId: admin.id, name: admin.name, email: admin.email },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );
  const failures = [];
  for (const order of approvedOrders) {
    const response = await fetch(`http://127.0.0.1:3000/api/invoice/${order.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) failures.push({ id: order.id, status: response.status });
    else await response.arrayBuffer();
    console.log(`Order ${order.id}: ${response.status}`);
  }

  if (failures.length) {
    throw new Error(`Invoice regeneration failed: ${JSON.stringify(failures)}`);
  }
  console.log(`Regenerated ${approvedOrders.length} invoice PDFs successfully.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => prisma.$disconnect());
