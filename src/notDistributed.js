'use strict';

function buildNotDistributedPurchases(rows) {
  return rows.map((row) => {
    const sorting = row.sortingdata && typeof row.sortingdata === 'object'
      ? row.sortingdata
      : {};
    const products = Array.isArray(sorting.products) ? sorting.products : [];

    return {
      purchaseDate: sorting.purchaseDate || row.date,
      products: products.map((product) => ({
        productId: product.productId,
        productName: product.name,
        sizes: (Array.isArray(product.sizes) ? product.sizes : []).map(
          (size) => ({
            sizeId: size.size,
            sizeDescription: size.sizedesc,
            grossWeightKg: size.grossWeightKg
          })
        )
      }))
    };
  });
}

module.exports = { buildNotDistributedPurchases };
