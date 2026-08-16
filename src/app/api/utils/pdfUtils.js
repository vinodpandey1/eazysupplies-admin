import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";
import { PrismaClient } from "@prisma/client";
import { handleHtmlFromOrder } from "./jwt";

const prisma = new PrismaClient();
const inFlight = new Map();
const INVOICE_TEMPLATE_VERSION = "2026-08-16-v2";

export function getInvoiceFilename(orderId) {
  return `performa-invoice${Number(orderId)}.pdf`;
}

export function getInvoiceFilePath(orderId) {
  if (!process.env.FILE_PATH) throw new Error("FILE_PATH is not configured");
  return path.join(process.env.FILE_PATH, "invoice", getInvoiceFilename(orderId));
}

async function renderInvoice(orderId, force) {
  const filePath = getInvoiceFilePath(orderId);
  const versionPath = `${filePath}.version`;
  const isCurrent = fs.existsSync(versionPath) && fs.readFileSync(versionPath, "utf8").trim() === INVOICE_TEMPLATE_VERSION;
  if (!force && isCurrent && fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return filePath;

  const { html, userId } = await handleHtmlFromOrder(Number(orderId));
  if (!html) throw new Error(`Invoice data was not found for order ${orderId}`);
  if (/\b(?:NaN|undefined|null)\b/.test(html)) {
    throw new Error(`Invoice ${orderId} contains an invalid calculated value`);
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: "new",
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 30000 });
    await page.pdf({
      path: temporaryPath,
      format: "A4",
      printBackground: true,
      landscape: true,
      margin: { top: 10, bottom: 10, left: 5, right: 5 },
    });
    fs.renameSync(temporaryPath, filePath);
    fs.writeFileSync(versionPath, INVOICE_TEMPLATE_VERSION);
  } finally {
    if (browser) await browser.close();
    if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
  }

  const filename = getInvoiceFilename(orderId);
  const existingAsset = await prisma.assets.findFirst({ where: { name: filename } });
  if (existingAsset) {
    await prisma.assets.update({
      where: { id: existingAsset.id },
      data: { path: `/invoice/${filename}`, author: String(userId ?? "") },
    });
  } else {
    await prisma.assets.create({
      data: {
        name: filename,
        type: "invoice",
        path: `/invoice/${filename}`,
        author: String(userId ?? ""),
        tag: filename,
      },
    });
  }
  await prisma.order.update({ where: { id: Number(orderId) }, data: { invoicepath: filePath } });
  return filePath;
}

export async function generateInvoicePdf(orderId, options = {}) {
  const id = Number(orderId);
  if (!Number.isInteger(id) || id < 1) throw new Error("A valid order id is required");
  const force = Boolean(options.force);
  const key = `${id}:${force}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = renderInvoice(id, force).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}
