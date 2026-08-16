import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { OrderEmailTemp } from '@/utils/constants';
import crypto from "crypto";
import { JsonObject, JsonArray } from '@prisma/client/runtime/library';
import { calculateInvoiceTotals, finiteNumber, parseInvoiceItems } from './invoiceMath';
const prisma = new PrismaClient();

export function parseAuthCookie(cookie: string | null): string | null {
  if (!cookie) return null;
  const cookies = cookie.split('; ').reduce((prev, current) => {
    const [name, value] = current.split('=');
    prev[name] = decodeURIComponent(value);
    return prev;
  }, {} as Record<string, string>);

  return cookies['authToken'] || null;
}

export function verifyJwt(token: string) {
  try {
    return jwt.verify(token, process.env.JWT_SECRET!) //as jwt.JwtPayload;
  } catch (error) {
    return null;
  }
}

export async function authenticate(request) {
  const authorization = request.headers.get("authorization") || "";
  const bearerToken = authorization.toLowerCase().startsWith("bearer ")
    ? authorization.slice(7).trim()
    : null;
  const token = parseAuthCookie(request.headers.get("cookie")) || bearerToken;
  return token ? verifyJwt(token) : null;
}

export async function getUserFromToken(request) {
  const payload = await authenticate(request);
  return payload && payload.userId ? payload : null;
}

export async function getUserId(request) {
  const payload = await getUserFromToken(request);
  return payload && payload.userId ? payload.userId : null;
}

export async function verifyAdmin(request) {
  try {
    const payload = await authenticate(request);
    const userRole = await verifyRole(payload.userId);
    return userRole == 'admin';
  } catch (error) {
    return null;
  }
}

export async function verifyRole(userId: number): Promise<string> {
  const user = await findUserById(userId);
  if (!user) return "";
  if (!user.status) return "";
  const roles = await prisma.role.findUnique({ where: { id: user.roleId } });

  return roles.name;
}
async function findUserById(userId: number) {
  return await prisma.user.findUnique({
    where: {
      id: userId
    }
  })
}

export async function generateTransactionId(): Promise<string> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      INSERT INTO payment_txn_counter () VALUES ()
    `);

    const result = await tx.$queryRaw<
      { transaction_id: string }[]
    >`
      SELECT
        CONCAT(
          DATE_FORMAT(NOW(), '%Y%m%d'),
          LPAD(LAST_INSERT_ID(), 4, '0')
        ) AS transaction_id
    `;

    return "earthling" + result[0].transaction_id;
  });
}

function generateProductDiscount(product, ordId, taxData) {
  let jsonData = product.jsonData;
  let _dd = [];
  if (!jsonData) {
    _dd = [{ discountPercentage: 0, discountAmount: 0, taxId: 0, taxAmount: 0, taxpercent: 0, totalPrice: 0 }];
    let _taxId = Number(product?.tax);
    let _taxpercent = taxData.filter((elm) => Number(elm.id) == _taxId);
    _taxpercent = _taxpercent[0].value;
    let _taxAmt = Number(product?.price) * Number(_taxpercent) / 100;
    _dd[0].taxAmount = _taxAmt;
    _dd[0].taxpercent = _taxpercent;
    _dd[0].totalPrice = Number(product?.price) + _taxAmt;
    return _dd[0];
  }
  else {
    _dd = jsonData.filter(el => el.orderId == ordId);
    if (_dd.length > 0) {
      let _taxId = Number(product?.tax);
      let _taxpercent = taxData.filter((elm) => Number(elm.id) == _taxId);
      _taxpercent = _taxpercent[0].value;
      let _taxAmt = Number(_dd[0].sellingPrice) * Number(_taxpercent) / 100;
      _dd[0].taxAmount = _taxAmt;
      _dd[0].taxpercent = _taxpercent;
      _dd[0].totalPrice = Number(_dd[0].sellingPrice) + _taxAmt;
      return _dd[0];
    }
  }
}

function generateProductTotalPrice(order, taxData) {
  let total = 0;
  for (let data of order.items) {
    let jsonData = data.product.jsonData;
    if (!jsonData) {
      let _taxId = Number(data.product?.tax);
      let _taxpercent = taxData.filter((elm) => Number(elm.id) == _taxId);
      _taxpercent = _taxpercent[0].value;
      let _taxAmt = Number(data.product?.price) * Number(_taxpercent) / 100;
      total += (Number(data.product?.price) + _taxAmt) * data.quantity;
    }
    else {
      let _dd = jsonData.filter(el => el.orderId == order.id);
      if (_dd.length > 0) {
        let _taxId = Number(data.product?.tax);
        let _taxpercent = taxData.filter((elm) => Number(elm.id) == _taxId);
        _taxpercent = _taxpercent[0].value;
        let _taxAmt = Number(_dd[0].sellingPrice) * Number(_taxpercent) / 100;
        total += (Number(_dd[0].sellingPrice) + _taxAmt) * data.quantity;
      }
    }
  }
  return total;
}

export async function handleHtmlToPdf(id) {
  function generateProductRows(products, taxData) {
    return products.map(p => `
    <tr>
      <td>${p?.product?.name}</td>
      <td>${p?.quantity}</td>
      <td>₹${p?.product?.price.toFixed(2)}</td>
      <td>${generateProductDiscount(p.product, id, taxData)?.discountPercentage}</td>
      <td>${(Number(generateProductDiscount(p.product, id, taxData)?.discountAmount) * Number(p?.quantity)).toFixed(2)}</td>
      <td>${generateProductDiscount(p.product, id, taxData)?.taxpercent}</td>
      <td>${(Number(generateProductDiscount(p.product, id, taxData)?.taxAmount) * Number(p?.quantity)).toFixed(2)}</td>
      <td>${Number(generateProductDiscount(p.product, id, taxData)?.totalPrice * Number(p?.quantity)).toFixed(2)}</td>
    </tr>
  `).join("");
  }

  function formatDate(date?: Date | null) {
    if (!date) return ""
    return date.toISOString().split("T")[0]
  }

  const orderData = await prisma.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: true,
        },
      },
      shipping: true,
      payment: true,
      user: true
    },
  })
  const taxData = await prisma.tax.findMany();
  let OrderTemp = OrderEmailTemp;
  let shippingAdds = orderData?.shipping.address + ', ' + orderData?.shipping?.city + ', ' + orderData?.shipping?.country;
  let subTotal = 0, Total = 0, tax = 0;
  let total = generateProductTotalPrice(orderData, taxData);
  const productRows = generateProductRows(orderData?.items, taxData);
  const userId = orderData?.user?.id;
  OrderTemp = OrderTemp.replace('@Order', id);
  OrderTemp = OrderTemp.replace('@OrderStatus', orderData?.status || "PENDING");
  OrderTemp = OrderTemp.replace("@OrderDate",formatDate(orderData?.createdAt))
  OrderTemp = OrderTemp.replace('@ShippingAddress', shippingAdds);
  OrderTemp = OrderTemp.replace('@PaymentStatus', orderData?.payment?.status || "PENDING");
  OrderTemp = OrderTemp.replace('@ProductBody', productRows);
  OrderTemp = OrderTemp.replace('@totalOrderAmount', total.toFixed(2));
  return {
    userId, html : OrderTemp
  }
}

const IV_LENGTH = 12;       // bytes
const GCM_TAG_LENGTH = 16; // bytes (128 bits)

export async function decryptData(encryptedData) {
  try {
    const combined = Buffer.from(encryptedData, "base64url");
    const iv = combined.slice(0, IV_LENGTH);
    const encryptedBytes = combined.slice(IV_LENGTH);
    const ciphertext = encryptedBytes.slice(0, encryptedBytes.length - GCM_TAG_LENGTH);
    const authTag = encryptedBytes.slice(encryptedBytes.length - GCM_TAG_LENGTH);
    const key = Buffer.from(process.env.ClinetSecretId, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted =
      decipher.update(ciphertext, null, "utf8") +
      decipher.final("utf8");
    return decrypted;
  } catch (err) {
    console.error("Error occurred during decryption:", err);
    return null;
  }
}

export async function handleHtmlFromOrder(id) {
  
const INVOICE_TEMPLATE = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        :root {
            --brand-green: #15803d;
            --light-green: #f0fdf4;
            --text-dark: #14532d;
            --text-muted: #65a30d;
            --border-color: #dcfce7;
        }
        body { 
            font-family: 'Segoe UI', Roboto, sans-serif; 
            color: var(--text-dark); 
            background-color: #f7fee7;
            padding: 20px;
            margin: 0;
        }
        .invoice-card { 
            max-width: 1000px;
            margin: auto; 
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(20, 83, 45, 0.1);
            overflow: hidden;
        }
        .header-top {
            background-color: var(--brand-green);
            padding: 25px 40px;
            color: white;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .logo-img {
            height: 45px; /* Small sized as requested */
            width: auto;
            display: block;
            filter: brightness(0) invert(1); /* Makes the logo white to match the green header */
        }
        .details-section {
            display: grid;
            grid-template-columns: 1fr 1fr;
            padding: 30px 40px;
            border-bottom: 1px solid var(--border-color);
        }
        .table-container { padding: 20px 30px; }
        table { width: 100%; border-collapse: collapse; min-width: 900px; }
        th { 
            text-align: right; 
            font-size: 11px; 
            text-transform: uppercase;
            color: var(--text-muted); 
            padding: 8px 4px;
            border-bottom: 2px solid var(--border-color);
        }
        th:first-child, td:first-child { text-align: left; }
        td { padding: 12px 8px; border-bottom: 1px solid var(--border-color); font-size: 11px; text-align: right; }
        .product-info { font-weight: 700; color: var(--brand-green); }
        .discount-text { color: #be123c; font-size: 11px; }
        .tax-text { color: #0369a1; font-size: 11px; }
        .summary-container {
            display: flex;
            justify-content: flex-end;
            padding: 30px 40px;
            background-color: var(--light-green);
        }
        .summary-box { width: 320px; }
        .summary-line { display: flex; justify-content: space-between; padding: 5px 0; font-size: 14px; }
        .total-line { 
            margin-top: 10px;
            padding-top: 10px;
            border-top: 2px solid var(--brand-green);
            font-weight: 800;
            font-size: 20px;
            color: var(--brand-green);
        }
        .footer { text-align: center; padding: 20px; font-size: 12px; color: var(--text-muted); }
    </style>
</head>
<body>
    <div class="invoice-card">
        <div class="header-top">
            <div>
                <img src="https://api.eazysupplies.com/api/file?file=LOGO_EARTHLING.png" alt="Earthling Logo" class="logo-img"> \${store_name}<br/>
                <small>GST : \${store_gstn}</small>
            </div>
            <div style="text-align: right;">
                <div style="font-weight: 700; font-size: 18px; letter-spacing: 1px;">INVOICE</div>
                <div style="font-size: 14px; opacity: 0.9;">#\${order_id}</div>
                <div style="font-size: 14px; opacity: 0.9;">\${PaymentStatus}</div>
            </div>
        </div>
        <div class="details-section">
            <div>
                <strong style="font-size: 11px; text-transform: uppercase; color: var(--text-muted);">Billed To:</strong>
                <div style="margin-top: 5px;"><strong>\${customer_name}</strong></div>
                <div style="font-size: 13px; opacity: 0.8;">\${customer_address}</div>
            </div>
            <div style="text-align: right;">
                <strong style="font-size: 11px; text-transform: uppercase; color: var(--text-muted);">Date of Issue:</strong>
                <div style="margin-top: 5px;">\${date}</div>
            </div>
        </div>
        <div class="table-container">
            <table>
                <thead>
                    <tr>
                        <th style="width: 20%;">Product Description</th>
                        <th>Qty</th>
                        <th>Unit Price</th>
                        <th>Disc %</th>
                        <th>Disc Amt</th>
                        <th>Selling Price</th>
                        <th>Tax Amt</th>
                        <th>Total</th>
                    </tr>
                </thead>
                <tbody>
                    \${items_html}
                </tbody>
            </table>
        </div>
        <div class="summary-container">
            <div class="summary-box">
                <div class="summary-line"><span>Gross Subtotal</span><span>\${gross_total}</span></div>
                <div class="summary-line" style="color: #be123c;"><span>Total Discount</span><span>-\${total_discount}</span></div>
                <div class="summary-line" style="color: #0369a1;"><span>Total GST/Tax</span><span>+\${total_tax}</span></div>
                <div class="total-line"><span>Grand Total</span><span style="float : right">\${grand_total}</span></div>
            </div>
        </div>
        <div class="footer">
            <p>Thank you for choosing Earthling! For support, email: \${support_email}</p>
            <p>&copy; 2026 \${store_name}.</p>
        </div>
    </div>
</body>
</html>
`.trim();
  

  function formatDate(date?: Date | null) {
    if (!date) return ""
    return date.toISOString().split("T")[0]
  }

  const orderData = await prisma.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          product: true,
        },
      },
      shipping: true,
      payment: true,
      user: true
    },
  })

  
  const userId = orderData?.user?.id;

const storedProducts = parseInvoiceItems(orderData?.jsonOrderData) as any[];
const products = await Promise.all((orderData?.items ?? []).map(async (item) => {
  const stored = storedProducts.find((candidate) =>
    Number(candidate?.productId) === Number(item.productId) ||
    String(candidate?.name ?? "") === String(item.product?.name ?? "")
  );
  const quantity = Math.max(1, finiteNumber(item.quantity, 1));
  const price = finiteNumber(item.price ?? item.product?.price);
  const discountPercentage = finiteNumber(stored?.discountPercentage);
  const discountAmount = finiteNumber(
    stored?._discountAmount ?? stored?.discountAmount,
    (price * discountPercentage) / 100
  );
  const sellingPrice = finiteNumber(stored?.sellingPrice, price - discountAmount);
  const tax = item.product?.tax
    ? await prisma.tax.findUnique({ where: { id: Number(item.product.tax) } })
    : null;
  const calculatedTax = (sellingPrice * finiteNumber(tax?.value)) / 100;
  const taxAmount = finiteNumber(stored?.taxamt ?? stored?.taxAmount, calculatedTax);
  return {
    name: item.product?.name || stored?.name || "Item",
    quantity,
    price,
    discountPercentage,
    discountAmount,
    sellingPrice,
    taxAmount,
    totalPrice: (sellingPrice + taxAmount) * quantity,
  };
}));
const totals = calculateInvoiceTotals(products);

// Outputting formatted strings for your invoice
const formattedTotals = {
  gross_total: totals.grossTotal.toFixed(2),
  total_discount: totals.totalDiscount.toFixed(2),
  total_tax: totals.totalTax.toFixed(2),
  grand_total: totals.grandTotal.toFixed(2)
};


// Assuming 'products' is your parsed JSON array
const items_html = products.map((item) => {
    // Basic calculations based on your JSON structure
    const unitPrice = item.price.toFixed(2);
    const discPercent = item.discountPercentage.toFixed(2);
    const discAmt = item.discountAmount.toFixed(2);
    const sellingPrice = item.sellingPrice.toFixed(2);
    const taxAmt = item.taxAmount.toFixed(2);
    const totalPrice = item.totalPrice.toFixed(2);

    return `
    <tr>
        <td class="product-info">
            ${item.name}
        </td>
        <td style="text-align: right;">${item.quantity}</td>
        <td style="text-align: right;">₹${unitPrice}</td>
        <td class="discount-text" style="text-align: right;">${discPercent}%</td>
        <td class="discount-text" style="text-align: right;">-₹${discAmt}</td>
        <td style="text-align: right;"><strong>₹${sellingPrice}</strong></td>
        <td class="tax-text" style="text-align: right;">+₹${taxAmt}</td>
        <td style="font-weight: 700; text-align: right;">₹${totalPrice}</td>
    </tr>
    `;
}).join('');
console.log(items_html);
  // 1. Prepare your data object
const shippingAdds = `
  ${orderData?.shipping?.address}
  ${orderData?.shipping?.city}, ${orderData?.shipping?.postalCode}, ${orderData?.shipping?.country}
`.trim();

const replacements = {
  '${order_id}': id,
  '${store_name}': 'Earthling Consumer Products Pvt. Ltd',
  '${store_gstn}': '07AAHCE4793Q1ZS',
  '${customer_name}': orderData?.user?.name,
  '${customer_address}': shippingAdds,
  '${date}': formatDate(orderData?.createdAt),
  '${support_email}': 'info@earthlingco.in',
  '${PaymentStatus}': orderData?.status || "PENDING",
  '${items_html}': items_html,
  '${gross_total}': `₹${formattedTotals.gross_total}`,
  '${total_discount}': `₹${formattedTotals.total_discount}`,
  '${total_tax}': `₹${formattedTotals.total_tax}`,
  '${grand_total}': `₹${formattedTotals.grand_total}`
};

// 2. Apply all replacements in one clean pass
let OrderTemp = INVOICE_TEMPLATE;

Object.entries(replacements).forEach(([placeholder, value]) => {
  // Use replaceAll to ensure all instances of the placeholder are caught
  OrderTemp = OrderTemp.replaceAll(placeholder, value || "");
});


  return {
    userId, html : OrderTemp
  }
}
