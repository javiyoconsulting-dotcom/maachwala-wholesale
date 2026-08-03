'use strict';

const { validateSendToBuyerPayload } = require('./sendToBuyer');

function parseBuyerAllocationMessage(body) {
  let payload = body;
  if (body?.message?.data) {
    try {
      payload = JSON.parse(
        Buffer.from(body.message.data, 'base64').toString('utf8')
      );
    } catch {
      return null;
    }
  }

  if (!payload || !Object.prototype.hasOwnProperty.call(payload, 'orgid')) {
    return null;
  }
  const orgid = String(payload.orgid);
  if (!/^\d+$/.test(orgid)) return null;

  const validation = validateSendToBuyerPayload(payload);
  if (validation.errors.length > 0 || !validation.payload) return null;
  return { orgid, ...validation.payload };
}

function buildBuyerAllocationRows(message) {
  return message.products.flatMap((product) =>
    product.sizes.flatMap((size) =>
      size.buyers.map((buyer) => ({
        purchasedate: message.purchaseDate,
        product: product.productId,
        productdesc: product.productName,
        size: size.sizeId,
        sizedesc: size.sizeDescription,
        buyerphone: buyer.phone,
        buyername: buyer.name,
        allocatedweight: buyer.weightKg,
        maxprice: buyer.maximumPrice,
        minprice: buyer.minimumPrice
      }))
    )
  );
}

module.exports = { buildBuyerAllocationRows, parseBuyerAllocationMessage };
