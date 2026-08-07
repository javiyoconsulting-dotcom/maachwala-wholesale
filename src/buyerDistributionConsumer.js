'use strict';

const { parseBuyerAllocationMessage } = require('./buyerAllocationConsumer');

function buildBuyerPurchases(message) {
  const buyers = new Map();

  for (const product of message.products) {
    for (const size of product.sizes) {
      for (const buyer of size.buyers) {
        let entry = buyers.get(buyer.phone);
        if (!entry) {
          entry = {
            phone: buyer.phone,
            name: buyer.name,
            sortingNumbers: new Set(),
            products: new Map()
          };
          buyers.set(buyer.phone, entry);
        }
        entry.sortingNumbers.add(size.sortingNumber);
        const key = `${size.sortingNumber}:${product.productId}:${size.sizeId}`;
        const existing = entry.products.get(key);
        if (existing) {
          existing.grossWeightKg += buyer.weightKg;
        } else {
          entry.products.set(key, {
            name: product.productName,
            size: size.sizeId,
            sizedesc: size.sizeDescription,
            productId: product.productId,
            minPrice: buyer.minimumPrice,
            maxPrice: buyer.maximumPrice,
            grossWeightKg: buyer.weightKg
          });
        }
      }
    }
  }

  return Array.from(buyers.values()).map((buyer) => {
    const products = Array.from(buyer.products.values());
    return {
      phone: buyer.phone,
      name: buyer.name,
      sortingNumbers: Array.from(buyer.sortingNumbers),
      purchase: {
        notes: '',
        currency: 'INR',
        products,
        totalCost: Number(products.reduce(
          (total, product) =>
            total + product.grossWeightKg * product.minPrice,
          0
        ).toFixed(2)),
        purchaseDate: message.purchaseDate
      }
    };
  });
}

function createBuyerDistributionConsumerService(repository) {
  return {
    parseMessage: parseBuyerAllocationMessage,
    process: (message) => repository.distribute(
      message.orgid,
      message,
      buildBuyerPurchases
    )
  };
}

module.exports = {
  buildBuyerPurchases,
  createBuyerDistributionConsumerService
};
