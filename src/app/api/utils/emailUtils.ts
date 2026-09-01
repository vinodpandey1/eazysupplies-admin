import { Order, PrismaClient } from '@prisma/client';
import Mailjet from 'node-mailjet';
import axios from 'axios';
const prisma = new PrismaClient();
const logDeliveryError = (channel: string, error: any) => {
  console.error(`[${channel}_DELIVERY_ERROR]`, {
    message: error?.message || "Delivery request failed",
    status: error?.response?.status || null,
  });
};

type PrismaOrder = {
  id: number;
  status: string;
  items: {
    quantity: number;
    price: number;
    product: {
      name: string;
    };
  }[];
  payment?: {
    mode?: string;
    status?: string;
  } | null;
};


export async function sendEmail(recepient: string, subject: string, body: string): Promise<boolean> {
  const apiKey = process.env.MAILJET_API_KEY;
  const apiSecret = process.env.MAILJET_API_SECRET;
  const from = process.env.MAIL_FROM;

  try {
    const mailjet = Mailjet.apiConnect(apiKey, apiSecret);

    const result = await mailjet.post('send', { version: 'v3.1' }).request({
      Messages: [
        {
          From: { Email: from, Name: 'Earthling Support' },
          To: [{ Email: recepient }],
          Subject: subject,
          TextPart: body || '',
          HTMLPart: body || ''
        }
      ]
    });
    return Boolean(result);
  } catch (err) {
    logDeliveryError("EMAIL", err);
    return false;
  }
}

export function sendWhatsApp(recepient: string, subject: string, body: string) {

}

export function sendSms(recepient: string, subject: string, body: string) {

}
/**
 * Creates a basic notification entry.
 * @param {Object} params - Notification details.
 * @param {string} params.name - Name of the notification.
 * @param {string} params.recepient - Recipient identifier (email/phone/userId).
 * @param {string} [params.remarks] - Optional remarks or message.
 * @returns {Promise<Object>} Created notification record.
 */
export async function createNotification(name: string, recepient: string, remarks = ""): Promise<object> {
  try {
    if (!name || !recepient) {
      throw new Error("Both 'name' and 'recepient' are required.");
    }

    const notification = await prisma["notification"].create({
      data: {
        name,
        recepient,
        remarks,
      },
    });

    return notification;
  } catch (error) {
    logDeliveryError("NOTIFICATION_CREATE", error);
    throw new Error("Failed to create notification.");
  }
}
// utils/sendMessage.ts

export async function sendWhatsAppOTP(receivername: string, receiverphone: string, otp: string) {

  let data = JSON.stringify({
    "recipient": {
      "name": receivername,
      "to": normalizeIndianMobile(receiverphone)
    },
    "whatsapp": {
      "type": "template",
      "template": {
        "name": "otp",
        "components": [
          {
            "type": "body",
            "parameters": [
              {
                "type": "text",
                "text": '"' + otp + '"'
              }
            ]
          },
          {
            "type": "button",
            "sub_type": "url",
            "index": "0",
            "parameters": [
              {
                "type": "text",
                "text": '"' + otp + '"'
              }
            ]
          }
        ]
      }
    }
  });
  let config = {
    method: 'post',
    maxBodyLength: Infinity,
    url: process.env.META_URL,
    headers: {
      'x-api-key': process.env.META_X_API_KEY,
      'x-api-secret': process.env.META_X_API_SECRET,
      'Content-Type': 'application/json'
    },
    data: data
  };
  try {
    const response = await axios.request(config);
    return response.status >= 200 && response.status < 300;
  } catch (error) {
    logDeliveryError("WHATSAPP_OTP", error);
    return false;
  }
}

function normalizeIndianMobile(mobile) {
  if (!mobile) return null;

  // Remove spaces, dashes, brackets
  let cleaned = mobile.replace(/[\s\-()]/g, '');

  // Handle 0091 prefix
  if (cleaned.startsWith('0091')) {
    cleaned = cleaned.slice(4);
  }

  // Handle +91 prefix
  if (cleaned.startsWith('+91')) {
    cleaned = cleaned.slice(3);
  }

  // Handle 91 prefix
  if (cleaned.startsWith('91')) {
    cleaned = cleaned.slice(2);
  }

  // Validate 10-digit Indian mobile number (starts with 6–9)
  if (!/^[6-9]\d{9}$/.test(cleaned)) {
    return null;
  }

  return `+91${cleaned}`;
}


export async function sendWhatsAppUserReg(receivername: string, receiverphone: string, receiveremail: string, receivergst: string, otp : string) {
  const supportemail = process.env.MAIL_FROM;
  const _data = JSON.stringify({
    "recipient": {
      "name": receivername,
      "to": normalizeIndianMobile(receiverphone)
    },
    "whatsapp": {
      "type": "template",
      "template": {
        "name": "reg_confirm_cpy_2",
        "components": [
          {
            "type": "body",
            "parameters": [
              {
                "type": "text",
                "text": '"' + receivername + '"'
              },
              {
                "type": "text",
                "text": '"' + receiveremail + '"' + '" OR "' + '"' + receivergst + '"' + '" OR WhatsApp with OTP ( ' +  otp + ' ) '
              },
              {
                "type": "text",
                "text": '"' + receiveremail + '"' 
              },
              {
                "type": "text",
                "text": "Earthling Consumer Products Pvt ltd."
              }
            ]
          }
        ]
      }
    }
  });
  var config = {
    method: 'post',
    url: process.env.META_URL,
    headers: {
      'x-api-key': process.env.META_X_API_KEY,
      'x-api-secret': process.env.META_X_API_SECRET,
      'Content-Type': 'application/json'
    },
    data: _data
  };

  try {
    const response = await axios(config);
    return response.status >= 200 && response.status < 300;
  } catch (error) {
    logDeliveryError("WHATSAPP_REGISTRATION", error);
    return false;
  }

}

export async function sendWhatsAppOrderCreate(receivername: string, receiverphone: string, orderid: string, productlist: string, productsummery : string) {
  

  const _datao = JSON.stringify({
    "recipient": {
      "name": receivername,
      "to": normalizeIndianMobile(receiverphone)
    },
    "whatsapp": {
      "type": "template",
      "template": {
        "name": "order_confirmation_1",
        "components": [
          {
            "type": "body",
            "parameters": [
              {
                "type": "text",
                "text": receivername
              },
              {
                "type": "text",
                "text":  "#" + orderid
              },
              {
                "type": "text",
                "text": productlist
              },
              {
                "type": "text",
                "text": productsummery
              },
              {
                "type": "text",
                "text": "Earthling Consumer Products Private Ltd"
              }
            ]
          }
        ]
      }
    }
  });
  var config = {
    method: 'post',
    url: process.env.META_URL,
    headers: {
      'x-api-key': process.env.META_X_API_KEY,
      'x-api-secret': process.env.META_X_API_SECRET,
      'Content-Type': 'application/json',
    },
    data: _datao
  };

  try {
    const response = await axios(config);
    return response.status >= 200 && response.status < 300;
  } catch (error) {
    logDeliveryError("WHATSAPP_ORDER", error);
    return false;
  }

}

export function generateOrderSummaryHTML(order: PrismaOrder, userName: string): string {
  const itemsHtml = order.items
    .map((item) => {
      const lineTotal = item.price * item.quantity;

      return `
        <tr>
          <td style="padding:4px 0;color:#374151">
            ${item.product.name}
            <span style="color:#6b7280">× ${item.quantity}</span>
          </td>
          <td align="right" style="padding:4px 0;color:#374151">
            ₹${lineTotal.toFixed(2)}
          </td>
        </tr>
      `;
    })
    .join("");

  const totalAmount = order.items.reduce(
    (sum, item) => sum + item.price * item.quantity,
    0
  );

  return `
    <div style="max-width:420px;font-family:Arial,Helvetica,sans-serif;border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#ffffff">

      <h3 style="margin:0 0 10px;font-size:16px;color:#111827">
        🧾Thanks ${userName} ! <br/> Here is your Earthling Order Summary
      </h3>

      <p style="margin:0 0 8px;font-size:13px;color:#374151">
        Order ID: <strong>#${order.id}</strong>
      </p>
      
      <div style="border-top:1px solid #e5e7eb;margin:10px 0"></div>

      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
        ${itemsHtml}
      </table>

      <div style="border-top:1px dashed #e5e7eb;margin:10px 0"></div>

      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
        <tr>
          <td style="color:#111827"><strong>Total</strong></td>
          <td align="right" style="color:#111827">
            <strong>₹${totalAmount.toFixed(2)}</strong>
          </td>
        </tr>
      </table>

      <p style="margin:12px 0 0;font-size:12px;color:#6b7280">
        Order Status: ${order.status}<br />
        Payment: ${order.payment?.mode || "—"} (${order.payment?.status || "—"})
      </p>

    </div>
  `;
}


function getApprovedProductListDetails (order : PrismaOrder) {
let approvedProductList = [];
  for(let data of order.items) {
approvedProductList.push({
  name : data.product.name,
  quantity : data.quantity,
})
  }
  return approvedProductList;
}

export function generateApprovedOrderSummaryHTML(order: PrismaOrder,userId: number, userName: string): string {
  const baseurl = process.env.API_PROD_URL;
  const itemsHtml = order.items
    .map((item) => {
      return `
        <tr>
          <td style="padding:4px 0;color:#374151">
            ${item.product.name}
            <span style="color:#6b7280">X ${item.quantity}</span>
          </td>
        </tr>
      `;
    })
    .join("");

  

  return `
    <div style="max-width:420px;font-family:Arial,Helvetica,sans-serif;border:1px solid #e5e7eb;border-radius:8px;padding:14px;background:#ffffff">

      <h3 style="margin:0 0 10px;font-size:16px;color:#111827">
        🧾Thanks ${userName} ! <br/> Here is your Earthling Order Summary
      </h3>

      <p style="margin:0 0 8px;font-size:13px;color:#374151">
        Order ID: <strong>#${order.id}</strong>
      </p>
      
      <div style="border-top:1px solid #e5e7eb;margin:10px 0"></div>

      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px">
        ${itemsHtml}
      </table>

      <div style="border-top:1px dashed #e5e7eb;margin:10px 0"></div>

      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px">
        <tr>
          <td style="color:#111827"><strong>Detail price with invoice</strong></td>
          <td align="right" style="color:#111827">
            <a href=""><strong>Invoice Link</strong></a>
          </td>
        </tr>
      </table>

      <p style="margin:12px 0 0;font-size:12px;color:#6b7280">
        Order Status: ${order.status}<br />
        <a href="${baseurl}/file?userId=${userId}&file=performa-invoice${order.id}.pdf" target="_blank">Invoice</a><br />
        Payment: ${order.payment?.mode || "—"} (${order.payment?.status || "—"})
      </p>

    </div>
  `;
}
