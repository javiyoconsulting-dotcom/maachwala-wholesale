'use strict';

const express = require('express');

function parseOrgid(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'orgid')) {
    return null;
  }

  const orgid = String(body.orgid);
  return /^\d+$/.test(orgid) ? orgid : null;
}

function createApp(customerService, salesSummaryService = null) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

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

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (error.code === '42P01' || error.code === '3F000') {
      return res.status(404).json({
        error: 'CUSTOMER_TABLE_NOT_FOUND',
        message: 'The organization schema or customers table does not exist'
      });
    }

    if (error.code === 'DISCOUNT_NOT_FOUND' ||
        error.code === 'SALES_NOT_FOUND') {
      return res.status(404).json({
        error: error.code,
        message: error.message
      });
    }

    if (error.code === 'INVALID_DISCOUNT') {
      return res.status(422).json({
        error: error.code,
        message: error.message
      });
    }

    res.status(500).json({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Unable to retrieve customers'
    });
  });

  return app;
}

module.exports = { createApp, parseOrgid };
