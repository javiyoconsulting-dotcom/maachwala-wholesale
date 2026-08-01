'use strict';

const express = require('express');
const { randomUUID } = require('node:crypto');
const { validateCreateCustomersPayload } = require('./createCustomers');
const { validateCreatePurchasePayload } = require('./createPurchase');

function parseOrgid(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'orgid')) {
    return null;
  }

  const orgid = String(body.orgid);
  return /^\d+$/.test(orgid) ? orgid : null;
}

function createApp(
  customerService,
  salesSummaryService = null,
  customerPaymentService = null,
  purchaseService = null
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'wholesellerservice' });
  });

  app.post('/wholesale/customers', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    if (!orgid) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'orgid is required and must contain digits only'
      });
    }

    try {
      const refresh = req.query.refresh === 'true';
      const result = await customerService.getCustomers(orgid, { refresh });
      res.set('X-Cache', result.cacheStatus);
      return res.json(result.customers);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/customers/refresh', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    if (!orgid) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'orgid is required and must contain digits only'
      });
    }

    try {
      const result = await customerService.getCustomers(orgid, { refresh: true });
      res.set('X-Cache', result.cacheStatus);
      return res.json(result.customers);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/createcustomers', async (req, res, next) => {
    const requestId = req.get('X-Request-Id') || randomUUID();
    res.set('X-Request-Id', requestId);

    const validation = validateCreateCustomersPayload(req.body);
    if (validation.errors.length > 0) {
      return res.status(400).json({
        status: 'error',
        requestId,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request contains invalid customer data',
          details: validation.errors
        }
      });
    }

    try {
      const customers = await customerService.createCustomers(
        validation.orgid,
        validation.customers
      );
      return res.status(201).json({
        status: 'success',
        requestId,
        orgid: validation.orgid,
        insertedCount: customers.length,
        customers: customers.map((customer) => ({
          id: customer.id,
          number: customer.number,
          name: customer.name,
          phone: customer.phone,
          createdAt: customer.created_at
        }))
      });
    } catch (error) {
      error.requestId = requestId;
      return next(error);
    }
  });

  async function createPurchase(req, res, next) {
    const requestId = req.get('X-Request-Id') || randomUUID();
    res.set('X-Request-Id', requestId);
    const orgid = req.params.orgid
      ? (/^\d+$/.test(req.params.orgid) ? req.params.orgid : null)
      : parseOrgid(req.body);
    const validation = validateCreatePurchasePayload(req.body);

    if (!orgid || validation.errors.length > 0) {
      const details = [...validation.errors];
      if (!orgid) {
        details.unshift({
          field: 'orgid',
          message: 'orgid is required and must contain digits only'
        });
      }
      return res.status(400).json({
        status: 'error',
        requestId,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request contains invalid purchase data',
          details
        }
      });
    }
    if (!purchaseService) {
      return res.status(503).json({
        status: 'error',
        requestId,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Purchase service is not configured'
        }
      });
    }

    try {
      const purchase = await purchaseService.create(
        orgid,
        validation.purchase
      );
      return res.status(201).json({
        status: 'success',
        requestId,
        orgid,
        purchase: {
          id: purchase.id,
          purchaseDate: purchase.purchase_date,
          totalCost: Number(purchase.total_cost),
          currency: purchase.currency,
          products: purchase.products,
          notes: purchase.notes,
          status: purchase.status,
          createdAt: purchase.created_at
        }
      });
    } catch (error) {
      error.requestId = requestId;
      return next(error);
    }
  }

  app.post('/wholesale/createpurchases', createPurchase);
  app.post('/wholesale/purchases', createPurchase);
  app.post('/wholesale/:orgid/purchases', createPurchase);

  app.post('/pubsub/post-sales-data', async (req, res, next) => {
    if (!salesSummaryService) {
      return res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Sales summary service is not configured'
      });
    }

    const message = salesSummaryService.parseMessage(req.body);
    if (!message) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Pub/Sub data must contain a numeric orgid and date in YYYY-MM-DD format'
      });
    }

    try {
      const result = await salesSummaryService.process(message.orgid, message.date);
      return res.status(200).json({
        status: 'processed',
        updatedRows: result.updatedRows,
        groupCount: result.summary.groupCount
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/pubsub/post-sales-data-customer', async (req, res, next) => {
    if (!customerPaymentService) {
      return res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Customer payment service is not configured'
      });
    }

    const message = customerPaymentService.parseMessage(req.body);
    if (!message) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Pub/Sub data must contain a numeric orgid and date in YYYY-MM-DD format'
      });
    }

    try {
      const result = await customerPaymentService.process(
        message.orgid,
        message.date
      );
      return res.status(200).json({
        status: 'processed',
        ...result
      });
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    const requestId = error.requestId || randomUUID();
    res.set('X-Request-Id', requestId);

    if (error.type === 'entity.parse.failed') {
      return res.status(400).json({
        status: 'error',
        requestId,
        error: {
          code: 'INVALID_JSON',
          message: 'The request body is not valid JSON'
        }
      });
    }

    if (error.type === 'entity.too.large') {
      return res.status(413).json({
        status: 'error',
        requestId,
        error: {
          code: 'PAYLOAD_TOO_LARGE',
          message: 'The request body exceeds the 256kb limit'
        }
      });
    }

    if (error.code === '42P01' || error.code === '3F000') {
      return res.status(404).json({
        status: 'error',
        requestId,
        error: {
          code: 'ORGANIZATION_RESOURCE_NOT_FOUND',
          message: 'The organization schema or required database resources do not exist'
        }
      });
    }

    if (error.code === '23505') {
      return res.status(409).json({
        status: 'error',
        requestId,
        error: {
          code: 'CUSTOMER_CONFLICT',
          message: 'A customer conflicts with an existing database record'
        }
      });
    }

    if (['22P02', '22003', '23502'].includes(error.code)) {
      return res.status(422).json({
        status: 'error',
        requestId,
        error: {
          code: 'DATABASE_VALIDATION_ERROR',
          message: 'Customer data is incompatible with the database schema'
        }
      });
    }

    if ([
      '53300',
      '57P01',
      '57P03',
      '57014',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT'
    ].includes(error.code)) {
      res.set('Retry-After', '5');
      return res.status(503).json({
        status: 'error',
        requestId,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'The database is temporarily unavailable'
        }
      });
    }

    if (error.code === 'DISCOUNT_NOT_FOUND' ||
        error.code === 'SALES_NOT_FOUND') {
      return res.status(404).json({
        status: 'error',
        requestId,
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    if (error.code === 'INVALID_DISCOUNT') {
      return res.status(422).json({
        status: 'error',
        requestId,
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    res.status(500).json({
      status: 'error',
      requestId,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Unable to process the request'
      }
    });
  });

  return app;
}

module.exports = { createApp, parseOrgid };
