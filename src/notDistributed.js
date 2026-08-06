'use strict';

function nullableNumber(value) {
  return value === null || value === undefined ? null : Number(value);
}

function buildNotDistributedPurchases(rows) {
  const purchases = new Map();

  for (const row of rows) {
    const purchaseKey = `${row.purchasedate}:${row.purchasenumber}:${row.sortingnumber}`;
    let purchase = purchases.get(purchaseKey);
    if (!purchase) {
      purchase = {
        purchaseDate: row.purchasedate,
        purchaseNumber: Number(row.purchasenumber),
        sortingNumber: Number(row.sortingnumber),
        products: [],
        productMap: new Map()
      };
      purchases.set(purchaseKey, purchase);
    }

    let product = purchase.productMap.get(String(row.productid));
    if (!product) {
      product = {
        productId: Number(row.productid),
        productName: row.productdesc,
        sizes: [],
        sizeMap: new Map()
      };
      purchase.productMap.set(String(row.productid), product);
      purchase.products.push(product);
    }

    let size = product.sizeMap.get(String(row.sizeid));
    if (!size) {
      const quantity = Number(row.quantity);
      const allocatedQuantity = nullableNumber(row.allocatedquantity) || 0;
      size = {
        sizeId: Number(row.sizeid),
        sizeDescription: row.sizedesc,
        quantity,
        allocatedQuantity,
        remainingQuantity: Math.max(0, quantity - allocatedQuantity),
        allocationComplete: Boolean(row.allocationcomplete),
        allocations: []
      };
      product.sizeMap.set(String(row.sizeid), size);
      product.sizes.push(size);
    }

    if (row.allocationid !== null && row.allocationid !== undefined) {
      size.allocations.push({
        allocationId: Number(row.allocationid),
        buyerName: row.buyername,
        buyerPhone: String(row.buyerphone),
        allocatedWeightKg: Number(row.allocatedweight),
        minimumPrice: nullableNumber(row.minprice),
        maximumPrice: nullableNumber(row.maxprice),
        buyerPrice: nullableNumber(row.buyerprice),
        buyerQuantity: nullableNumber(row.buyerquantity),
        buyerWeightDiscount: nullableNumber(row.buyerweightdiscount)
      });
    }
  }

  return Array.from(purchases.values()).map((purchase) => {
    delete purchase.productMap;
    for (const product of purchase.products) delete product.sizeMap;
    return purchase;
  });
}

module.exports = { buildNotDistributedPurchases };
