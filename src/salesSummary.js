'use strict';

function parseNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/.test(trimmed)) return null;

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, decimals = 6) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function buildSalesSummary(salesRows, discountWeight, orgid, date) {
  const groups = new Map();
  const invalidRecords = [];

  for (const salesRow of salesRows) {
    const records = Array.isArray(salesRow.data?.rows) ? salesRow.data.rows : [];

    for (const record of records) {
      const supplier = String(record.supplier || '').trim();
      const product = String(record.product || '').trim();
      const quantity = parseNumber(record.weight);
      const unitPrice = parseNumber(record.unitprice);

      if (!supplier || !product || quantity === null || unitPrice === null) {
        invalidRecords.push({
          salesRowId: salesRow.id,
          record,
          reason: 'supplier, product, weight, and unitprice must be present and numeric where applicable'
        });
        continue;
      }

      const key = `${supplier.toLocaleLowerCase()}::${product.toLocaleLowerCase()}`;
      let group = groups.get(key);
      if (!group) {
        group = {
          supplier,
          product,
          totalSalesQuantity: 0,
          unitPriceTotal: 0,
          unitPriceCount: 0,
          salesRecords: []
        };
        groups.set(key, group);
      }

      group.totalSalesQuantity += quantity;
      group.unitPriceTotal += unitPrice;
      group.unitPriceCount += 1;
      group.salesRecords.push({ salesRowId: salesRow.id, ...record });
    }
  }

  const summaryGroups = Array.from(groups.values()).map((group) => {
    const totalSalesQuantity = round(group.totalSalesQuantity);
    return {
      supplier: group.supplier,
      product: group.product,
      totalSalesQuantity,
      averageUnitPrice: round(group.unitPriceTotal / group.unitPriceCount),
      weightDiscount: round(
        totalSalesQuantity - Math.floor(totalSalesQuantity) * discountWeight
      ),
      salesRecords: group.salesRecords
    };
  });

  return {
    orgid,
    date,
    discountWeight,
    groupCount: summaryGroups.length,
    groups: summaryGroups,
    invalidRecordCount: invalidRecords.length,
    invalidRecords,
    generatedAt: new Date().toISOString()
  };
}

function buildCustomerBuyData(salesRows, customers, discountWeight) {
  const customerById = new Map(
    customers.map((customer) => [String(customer.number), customer])
  );
  const purchasesByCustomer = new Map();

  for (const salesRow of salesRows) {
    const records = Array.isArray(salesRow.data?.rows) ? salesRow.data.rows : [];

    for (const record of records) {
      const customerId = String(record.customerId || '').trim();
      const product = String(record.product || '').trim();
      const quantity = parseNumber(record.weight);
      const price = parseNumber(record.unitprice);
      const customer = customerById.get(customerId);

      if (!customer || !product || quantity === null || quantity < 0 ||
          price === null || price < 0) {
        continue;
      }

      let purchase = purchasesByCustomer.get(customerId);
      if (!purchase) {
        purchase = {
          id: Number(customer.number),
          name: customer.name,
          phone: Number(customer.phone),
          transactions: []
        };
        purchasesByCustomer.set(customerId, purchase);
      }

      const discountApplied = positiveMarker(record.weightdiscount);
      const weightDiscount = discountApplied
        ? round(Math.floor(quantity) * discountWeight)
        : 0;
      const total = round((quantity - weightDiscount) * price, 2);

      purchase.transactions.push({
        product,
        quantity,
        price,
        weightdiscount: weightDiscount,
        total
      });
    }
  }

  return { customers: Array.from(purchasesByCustomer.values()) };
}

function positiveMarker(value) {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['true', 'yes', 'y', '1'].includes(value.trim().toLowerCase());
}

module.exports = { buildCustomerBuyData, buildSalesSummary, parseNumber };
