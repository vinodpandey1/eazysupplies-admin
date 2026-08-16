import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { writeFile } from "fs/promises";
import { PrismaClient } from "@prisma/client";
import { authenticate, verifyAdmin, getUserId } from "../utils/jwt"; // adjust import path if needed
import { MESSAGES } from "../utils/statusConstant";       // adjust import path if needed
const prisma = new PrismaClient();

const handleError = (error) => {
  console.error(error);
  return NextResponse.json({ error: MESSAGES.SERVER_ERROR }, { status: 500 });
};

const unauthorized = () =>
  NextResponse.json({ error: MESSAGES.UNAUTHORIZED }, { status: 400 });

const baseDir = path.join(process.env.FILE_PATH, "/uploads");
const privateDir = path.join(process.env.FILE_PATH, "/private");
const invoiceDir = path.join(process.env.FILE_PATH, "/invoice");
// Recursively collect file info
function getFiles(dir, base = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  let files = [];

  for (const entry of entries) {
    const relativePath = path.join(base, entry.name);
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files = files.concat(getFiles(fullPath, relativePath));
    } else {
      files.push({
        name: entry.name,
        publicPath: `/uploads/${relativePath.replace(/\\/g, "/")}`,
        absolutePath: fullPath,
      });
    }
  }

  return files;
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get("file");
    const userId = searchParams.get("userId");
    const legacyInvoice = fileName?.match(/^performa-invoice(\d+)\.pdf$/);
    if (legacyInvoice) {
      return NextResponse.redirect(new URL(`/api/invoice/${legacyInvoice[1]}/pdf`, request.url));
    }
    // If ?file= is passed → return that file's absolute path
    if (fileName) {
      let files = getFiles(baseDir);
      let file = files.find(f => f.name === fileName);
      if (!file) {
        if(authenticate(request)) {
          files = getFiles(privateDir);
        file = files.find(f => f.name === fileName);
        if(!file) {
          files = getFiles(invoiceDir);
        file = files.find(f => f.name === fileName);
        }
        else
          return NextResponse.json(
            { success: false, message: "File not found" },
            { status: 404 }
          );
      } if(userId) {
          files = getFiles(invoiceDir);
        file = files.find(f => f.name === fileName);
        if (!file)
          return NextResponse.json(
            { success: false, message: "File not found" },
            { status: 404 }
          );
      }
    }
      const mime = fileName.endsWith(".png")
        ? "image/png"
        : fileName.endsWith(".jpg") || fileName.endsWith(".jpeg")
          ? "image/jpeg"
          : fileName.endsWith(".pdf")
            ? "application/pdf"
            : fileName.endsWith(".json")
              ? "application/json"
              : "application/octet-stream";       
      const fileBuffer = fs.readFileSync(file.absolutePath);
      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          "Content-Type": mime,
          "Content-Disposition": `inline; filename="${fileName}"`,
        },
      });
    }
    if (userId && authenticate(request)) { 
      let assets = await prisma.assets.findMany({ where: { author: userId } });
    return NextResponse.json({ success: true, assets });
    }
    // Otherwise, return all files
    const files = getFiles(baseDir);
    return NextResponse.json({ success: true, files });
  } catch (error) {
    console.log(error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(request) {
  if (!authenticate(request)) return unauthorized();
  const { searchParams } = new URL(request.url);
  const type = Number(searchParams.get("type"));
  const userId = await getUserId(request);
  if (!userId) {
        return NextResponse.json({ error: "No User available" }, { status: 400 });
      }
  if (verifyAdmin(request) && type)
    try {
      // Parse multipart form data
      const formData = await request.formData();
      const file = formData.get("file");
      if (!file || typeof file === "string") {
        return NextResponse.json({ error: "No file uploaded" }, { status: 400 }); 
      }
      
      const dir = type === 1 ? path.join(process.env.FILE_PATH, "/uploads") : path.join(process.env.FILE_PATH, "/private");
      // Create unique filename
      const bytes = await file.arrayBuffer();
      const buffer = Buffer.from(bytes);
      let fname = file.name;
      fname = fname.replace(/\s+/g, '');
      const fileName = `${Date.now()}-${fname}`;
      const filePath = path.join(dir, fileName);

      // Save file
      await writeFile(filePath, buffer);
      let asset;
      
      // Public URL (relative to /public)
      const publicPath = type == 1 ? `/` +  "uploads" + `/${fileName}` : `/` +  "private" + `/${fileName}`;
      asset = await prisma.assets.create({  data: {
       name : fileName,
        type : type == 1 ? "public" : "private",
        path: publicPath,
        author: userId.toString(),
        tag: fileName
      }, });
      return NextResponse.json({
        message: "File uploaded successfully",
        path: publicPath,
        assetId : asset ? asset.id : ""
      });
    } catch (error) {
      console.log("File upload error:", error);
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
}
