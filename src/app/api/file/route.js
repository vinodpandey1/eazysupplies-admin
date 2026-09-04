import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { writeFile } from "fs/promises";
import { PrismaClient } from "@prisma/client";
import { authenticate, verifyAdmin, getUserId } from "../utils/jwt";
import { MESSAGES } from "../utils/statusConstant";

const prisma = new PrismaClient();
const fileRoot = () => process.env.FILE_PATH || path.join(process.cwd(), "public");
const uploadDir = () => path.join(fileRoot(), "uploads");
const privateDir = () => path.join(fileRoot(), "private");
const invoiceDir = () => path.join(fileRoot(), "invoice");
const unauthorized = () => NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 401 });

function getFiles(dir, publicPrefix, base = "") {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];
  for (const entry of entries) {
    const relativePath = path.join(base, entry.name);
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(getFiles(fullPath, publicPrefix, relativePath));
    } else {
      files.push({
        name: entry.name,
        publicPath: `/${publicPrefix}/${relativePath.replace(/\\/g, "/")}`,
        absolutePath: fullPath,
      });
    }
  }
  return files;
}

function findFile(dir, prefix, requestedName) {
  const safeName = path.basename(requestedName);
  return getFiles(dir, prefix).find((file) => file.name === safeName);
}

function contentType(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  return ({
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".json": "application/json",
  })[extension] || "application/octet-stream";
}

async function canAccessInvoice(request, fileName, payload) {
  const match = path.basename(fileName).match(/^performa-invoice(\d+)\.pdf$/i);
  if (!match || !payload?.userId) return false;
  const order = await prisma.order.findUnique({
    where: { id: Number(match[1]) },
    select: { userId: true, approved: true, invoicepath: true },
  });
  if (!order?.approved || !order.invoicepath) return false;
  if (path.basename(order.invoicepath) !== path.basename(fileName)) return false;
  return (await verifyAdmin(request)) || order.userId === Number(payload.userId);
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const requestedFile = searchParams.get("file");
    const requestedUserId = searchParams.get("userId");

    if (requestedFile) {
      const safeName = path.basename(requestedFile);
      let file = findFile(uploadDir(), "uploads", safeName);
      const isPublicFile = Boolean(file);
      if (!file) {
        const payload = await authenticate(request);
        if (!payload?.userId) return unauthorized();

        const privateFile = findFile(privateDir(), "private", safeName);
        if (privateFile) {
          const isAdmin = await verifyAdmin(request);
          const asset = await prisma.assets.findFirst({
            where: { name: safeName },
            select: { author: true },
          });
          if (!isAdmin && asset?.author !== String(payload.userId)) {
            return NextResponse.json({ error: "File access denied" }, { status: 403 });
          }
          file = privateFile;
        }

        if (!file) {
          const invoiceFile = findFile(invoiceDir(), "invoice", safeName);
          if (invoiceFile && await canAccessInvoice(request, safeName, payload)) file = invoiceFile;
        }
      }

      if (!file) {
        return NextResponse.json({ success: false, message: "File not found" }, { status: 404 });
      }
      return new NextResponse(fs.readFileSync(file.absolutePath), {
        status: 200,
        headers: {
          "Content-Type": contentType(safeName),
          "Content-Disposition": `inline; filename="${safeName}"`,
          "Cache-Control": isPublicFile
            ? "public, max-age=86400, stale-while-revalidate=604800"
            : "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    if (requestedUserId) {
      const payload = await authenticate(request);
      if (!payload?.userId) return unauthorized();
      const isAdmin = await verifyAdmin(request);
      if (!isAdmin && Number(requestedUserId) !== Number(payload.userId)) {
        return NextResponse.json({ error: "Asset access denied" }, { status: 403 });
      }
      const assets = await prisma.assets.findMany({ where: { author: String(requestedUserId) } });
      return NextResponse.json({ success: true, assets });
    }

    return NextResponse.json({ success: true, files: getFiles(uploadDir(), "uploads") });
  } catch (error) {
    console.error("File API error:", error);
    return NextResponse.json({ success: false, error: "Unable to process file request" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const payload = await authenticate(request);
    if (!payload?.userId) return unauthorized();
    if (!(await verifyAdmin(request))) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const type = Number(searchParams.get("type"));
    if (![1, 2].includes(type)) {
      return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
    }

    const userId = await getUserId(request);
    const formData = await request.formData();
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const dir = type === 1 ? uploadDir() : privateDir();
    fs.mkdirSync(dir, { recursive: true });
    const originalName = path.basename(file.name).replace(/[^a-zA-Z0-9._-]/g, "");
    if (!originalName) {
      return NextResponse.json({ error: "Invalid file name" }, { status: 400 });
    }
    const fileName = `${Date.now()}-${originalName}`;
    await writeFile(path.join(dir, fileName), Buffer.from(await file.arrayBuffer()));

    const publicPath = `/${type === 1 ? "uploads" : "private"}/${fileName}`;
    const asset = await prisma.assets.create({
      data: {
        name: fileName,
        type: type === 1 ? "public" : "private",
        path: publicPath,
        author: String(userId),
        tag: fileName,
      },
    });
    return NextResponse.json({
      message: "File uploaded successfully",
      path: publicPath,
      assetId: asset.id,
    });
  } catch (error) {
    console.error("File upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
