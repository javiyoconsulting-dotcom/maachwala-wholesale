'use strict';

const express = require('express');
const swaggerUi = require('swagger-ui-express');
const { randomUUID } = require('node:crypto');
const { validateCreateCustomersPayload } = require('./createCustomers');
const { validateCreateSuppliersPayload } = require('./createSuppliers');
const {
  validateUpdateSalesResponsePayload
} = require('./updateSalesResponse');
const { validateCreatePurchasePayload } = require('./createPurchase');
const { validateCreateSortingPayload } = require('./createSorting');
const { validateCreateGroupPayload } = require('./createGroup');
const { validateUpdateGroupPayload } = require('./updateGroup');
const { validateSendToBuyerPayload } = require('./sendToBuyer');
const {
  validateUpdatePurchaseResponsePayload
} = require('./updatePurchaseResponse');
const {
  invalidPurchaseSalesResponseReason
} = require('./purchaseSalesResponseConsumer');
const { parseDate } = require('./pubsub');
const { openapiDocument } = require('./openapi');

function parseOrgid(body) {
  if (!body || !Object.prototype.hasOwnProperty.call(body, 'orgid')) {
    return null;
  }

  const orgid = String(body.orgid);
  return /^\d+$/.test(orgid) ? orgid : null;
}

function writeStructuredLog(entry) {
  console.log(JSON.stringify(entry));
}

function requestLoggingMiddleware(req, res, next) {
  const requestId = req.get('X-Request-Id') || randomUUID();
  const startedAt = process.hrtime.bigint();
  req.requestId = requestId;
  res.set('X-Request-Id', requestId);

  const originalJson = res.json.bind(res);
  res.json = (body) => {
    res.locals.responseBody = body;
    return originalJson(body);
  };

  res.on('finish', () => {
    if (res.statusCode < 400) return;
    const responseBody = res.locals.responseBody;
    const responseError = responseBody?.error;
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const rawOrgid = req.body?.orgid ?? req.params?.orgid;
    const orgid = /^\d+$/.test(String(rawOrgid ?? ''))
      ? String(rawOrgid)
      : undefined;
    const internalError = res.locals.internalError;

    writeStructuredLog({
      severity: res.statusCode >= 500 ? 'ERROR' : 'WARNING',
      event: 'http_request_failed',
      requestId,
      method: req.method,
      path: req.originalUrl?.split('?')[0],
      status: res.statusCode,
      durationMs: Math.round(durationMs * 100) / 100,
      ...(orgid ? { orgid } : {}),
      errorCode: typeof responseError === 'object'
        ? responseError.code
        : responseError,
      errorMessage: typeof responseError === 'object'
        ? responseError.message
        : responseBody?.message,
      validationDetails: typeof responseError === 'object' &&
        Array.isArray(responseError.details)
        ? responseError.details
        : undefined,
      internalErrorCode: internalError?.code,
      internalErrorMessage: internalError?.message,
      trace: req.get('X-Cloud-Trace-Context')?.split('/')[0],
      userAgent: req.get('user-agent')
    });
  });

  next();
}

function createApp(
  customerService,
  salesSummaryService = null,
  customerPaymentService = null,
  purchaseService = null,
  groupService = null,
  buyerPublisher = null,
  buyerAllocationConsumer = null,
  sellResponseService = null,
  buyerDistributionConsumer = null,
  discountService = null,
  purchaseResponsePublisher = null,
  purchaseSalesResponseConsumer = null,
  tenantProvisioningConsumer = null,
  supplierService = null
) {
  const app = express();
  app.disable('x-powered-by');
  app.use(requestLoggingMiddleware);
  app.use(express.json({ limit: '256kb' }));

  app.get('/openapi.json', (_req, res) => res.json(openapiDocument));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiDocument, {
    customSiteTitle: 'MaachWala Wholesale API',
    swaggerOptions: { displayRequestDuration: true, tryItOutEnabled: true }
  }));

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
          totalCost: purchase.total_cost === null ||
            purchase.total_cost === undefined
            ? null
            : Number(purchase.total_cost),
          currency: purchase.currency,
          products: purchase.products,
          notes: purchase.notes,
          status: purchase.status,
          number: Number(purchase.number),
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

  app.post('/wholesale/getpurchases/sorting', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    if (!orgid) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid is required and must contain digits only'
        }
      });
    }
    if (!purchaseService) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Purchase service is not configured'
        }
      });
    }

    try {
      const purchases = await purchaseService.findDataForSorting(orgid);
      res.set('X-Result-Count', String(purchases.length));
      return res.status(200).json(purchases);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/getpurchaselistbystatus', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    const rawStatusCode = req.body?.statuscode ?? req.body?.statusCode;
    const statusCode = typeof rawStatusCode === 'number'
      ? rawStatusCode
      : Number(String(rawStatusCode ?? '').trim());
    if (!orgid || !Number.isSafeInteger(statusCode) || statusCode < 0) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid and a non-negative integer statuscode are required'
        }
      });
    }
    if (!purchaseService?.findByStatus) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Purchase list by status service is not configured'
        }
      });
    }

    try {
      const purchases = await purchaseService.findByStatus(orgid, statusCode);
      res.set('X-Result-Count', String(purchases.length));
      return res.status(200).json(purchases);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/createsorting', async (req, res, next) => {
    const requestId = req.get('X-Request-Id') || randomUUID();
    res.set('X-Request-Id', requestId);
    const orgid = parseOrgid(req.body);
    const validation = validateCreateSortingPayload(req.body);

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
          message: 'The request contains invalid sorting data',
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
      const updated = await purchaseService.updateSorting(
        orgid,
        validation.sorting
      );
      return res.status(200).json({
        status: 'success',
        requestId,
        orgid,
        purchaseId: updated.id,
        purchaseDate: updated.date,
        purchaseNumber: Number(updated.number),
        purchaseStatus: Number(updated.status),
        sortingNumber: Number(updated.sortingNumber),
        insertedCount: updated.insertedCount,
        sortingRows: updated.sortingRows.map((row) => ({
          ...row,
          purchasenumber: Number(row.purchasenumber),
          number: Number(row.number)
        })),
        sortingdata: updated.sortingdata
      });
    } catch (error) {
      error.requestId = requestId;
      return next(error);
    }
  });

  app.post('/wholesale/notdistributed', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    if (!orgid) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid is required and must contain digits only'
        }
      });
    }
    if (!purchaseService) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Purchase service is not configured'
        }
      });
    }

    try {
      const purchases = await purchaseService.findNotDistributed(orgid);
      res.set('X-Result-Count', String(purchases.length));
      return res.status(200).json(purchases);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/creategroup', async (req, res, next) => {
    const requestId = req.get('X-Request-Id') || randomUUID();
    res.set('X-Request-Id', requestId);
    const orgid = parseOrgid(req.body);
    const validation = validateCreateGroupPayload(req.body);

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
          message: 'The request contains invalid group data',
          details
        }
      });
    }
    if (!groupService) {
      return res.status(503).json({
        status: 'error',
        requestId,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Group service is not configured'
        }
      });
    }

    try {
      const group = await groupService.create(orgid, validation.group);
      return res.status(201).json({
        status: 'success',
        requestId,
        orgid,
        group: {
          id: group.id,
          number: group.number,
          name: group.name,
          associates: group.data,
          createdAt: group.created_at
        }
      });
    } catch (error) {
      error.requestId = requestId;
      return next(error);
    }
  });

  app.post('/wholesale/getgroups', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    if (!orgid) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid is required and must contain digits only'
        }
      });
    }
    if (!groupService) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Group service is not configured'
        }
      });
    }

    try {
      const groups = await groupService.findAll(orgid);
      res.set('X-Result-Count', String(groups.length));
      return res.status(200).json(groups);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/updategroup', async (req, res, next) => {
    const requestId = req.get('X-Request-Id') || randomUUID();
    res.set('X-Request-Id', requestId);
    const orgid = parseOrgid(req.body);
    const validation = validateUpdateGroupPayload(req.body);

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
          message: 'The request contains invalid group update data',
          details
        }
      });
    }
    if (!groupService) {
      return res.status(503).json({
        status: 'error',
        requestId,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Group service is not configured'
        }
      });
    }

    try {
      const group = await groupService.updateAssociates(
        orgid,
        validation.update
      );
      return res.status(200).json({
        status: 'success',
        requestId,
        orgid,
        group: {
          id: group.id,
          number: group.number,
          name: group.name,
          data: group.data,
          createdAt: group.created_at
        }
      });
    } catch (error) {
      error.requestId = requestId;
      return next(error);
    }
  });

  async function publishBuyerAllocation(req, res, next) {
    const requestId = req.get('X-Request-Id') || randomUUID();
    res.set('X-Request-Id', requestId);
    const orgid = parseOrgid(req.body);
    const validation = validateSendToBuyerPayload(req.body);

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
          message: 'The request contains invalid buyer allocation data',
          details
        }
      });
    }
    if (!buyerPublisher) {
      return res.status(503).json({
        status: 'error',
        requestId,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Buyer publisher is not configured'
        }
      });
    }

    try {
      const payload = { orgid, ...validation.payload };
      const messageId = await buyerPublisher.publish(payload);
      return res.status(202).json({
        status: 'published',
        requestId,
        topic: 'projects/maachwala/topics/WHOLESALE_CREATE_SALE_PURCHASE',
        messageId
      });
    } catch (error) {
      error.requestId = requestId;
      return next(error);
    }
  }

  app.post('/wholesale/buyerallocation', publishBuyerAllocation);
  app.post('/wholesale/buyerallocatiob', publishBuyerAllocation);
  app.post('/wholesale/sendtobuyer', publishBuyerAllocation);

  app.post('/wholesale/sellresponse', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    const purchaseDate = parseDate(
      req.body?.purchaseDate ?? req.body?.purchasedate
    );
    if (!orgid || !purchaseDate) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid and a valid purchaseDate (YYYY-MM-DD) are required'
        }
      });
    }
    if (!sellResponseService) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Sell response service is not configured'
        }
      });
    }

    try {
      const allocations = await sellResponseService.findByPurchaseDate(
        orgid,
        purchaseDate
      );
      res.set('X-Result-Count', String(allocations.length));
      return res.status(200).json(allocations);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/updatesalesresponse', async (req, res, next) => {
    const requestId = req.get('X-Request-Id') || randomUUID();
    res.set('X-Request-Id', requestId);
    const validation = validateUpdateSalesResponsePayload(req.body);
    if (validation.errors.length > 0) {
      return res.status(400).json({
        status: 'error',
        requestId,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request contains invalid sales response data',
          details: validation.errors
        }
      });
    }
    if (!sellResponseService?.updateSalesResponse) {
      return res.status(503).json({
        status: 'error',
        requestId,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Update sales response service is not configured'
        }
      });
    }

    try {
      const result = await sellResponseService.updateSalesResponse(
        validation.payload
      );
      return res.status(200).json({
        status: 'success',
        requestId,
        orgid: validation.payload.orgid,
        sortingnumber: validation.payload.sortingnumber,
        ...result
      });
    } catch (error) {
      error.requestId = requestId;
      return next(error);
    }
  });

  app.post('/wholesale/notsettledtransactions', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    if (!orgid) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid is required and must contain digits only'
        }
      });
    }
    if (!sellResponseService?.findNotSettled) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Not-settled transactions service is not configured'
        }
      });
    }

    try {
      const transactions = await sellResponseService.findNotSettled(orgid);
      res.set('X-Result-Count', String(transactions.length));
      return res.status(200).json(transactions);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/updatepurchaseresponse', async (req, res, next) => {
    const requestId = req.get('X-Request-Id') || randomUUID();
    res.set('X-Request-Id', requestId);
    const validation = validateUpdatePurchaseResponsePayload(req.body);
    if (validation.errors.length > 0) {
      return res.status(400).json({
        status: 'error',
        requestId,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The purchase response contains invalid data',
          details: validation.errors
        }
      });
    }
    if (!purchaseResponsePublisher) {
      return res.status(503).json({
        status: 'error',
        requestId,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Purchase response publisher is not configured'
        }
      });
    }

    try {
      const messageId = await purchaseResponsePublisher.publish(
        validation.payload
      );
      return res.status(202).json({
        status: 'published',
        requestId,
        topic: 'projects/maachwala/topics/UPDATE_PURCHASE_SALES_RESPONSE',
        messageId,
        data: validation.payload
      });
    } catch (error) {
      error.requestId = requestId;
      return next(error);
    }
  });

  app.post('/wholesale/getsales', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    const purchaseDate = parseDate(
      req.body?.purchasedate ?? req.body?.purchaseDate
    );
    if (!orgid || !purchaseDate) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid and a valid purchasedate (YYYY-MM-DD) are required'
        }
      });
    }
    if (!salesSummaryService?.findDataByDate) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Get sales service is not configured'
        }
      });
    }

    try {
      const sales = await salesSummaryService.findDataByDate(
        orgid,
        purchaseDate
      );
      res.set('X-Result-Count', String(sales.length));
      return res.status(200).json(sales);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/salesummary', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    const salesDate = parseDate(
      req.body?.salesDate ?? req.body?.salesdate ?? req.body?.date
    );
    if (!orgid || !salesDate) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid and a valid salesDate (YYYY-MM-DD) are required'
        }
      });
    }
    if (!salesSummaryService?.findSummaryByDate) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Sales summary fetch service is not configured'
        }
      });
    }

    try {
      const summary = await salesSummaryService.findSummaryByDate(
        orgid,
        salesDate
      );
      return res.status(200).json(summary);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/updatesalesummary', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    const salesDate = parseDate(req.body?.date);
    const data = req.body?.data;
    if (!orgid || !salesDate || !data || typeof data !== 'object' ||
        Array.isArray(data)) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid, a valid date (YYYY-MM-DD), and data object are required'
        }
      });
    }
    if (!salesSummaryService?.updateSummaryByDate) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Sales summary update service is not configured'
        }
      });
    }

    try {
      const result = await salesSummaryService.updateSummaryByDate(
        orgid,
        salesDate,
        data
      );
      return res.status(200).json({
        status: 'success',
        orgid,
        date: salesDate,
        ...result
      });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/getdiscountmaster', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    if (!orgid) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid is required and must contain digits only'
        }
      });
    }
    if (!discountService?.findAll) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Discount master service is not configured'
        }
      });
    }

    try {
      const discounts = await discountService.findAll(orgid);
      res.set('X-Result-Count', String(discounts.length));
      return res.status(200).json(discounts);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/getsuppliers', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    if (!orgid) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid is required and must contain digits only'
        }
      });
    }
    if (!supplierService?.findAll) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Supplier service is not configured'
        }
      });
    }

    try {
      const suppliers = await supplierService.findAll(orgid);
      res.set('X-Result-Count', String(suppliers.length));
      return res.status(200).json(suppliers);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/createsuppliers', async (req, res, next) => {
    const requestId = req.get('X-Request-Id') || randomUUID();
    res.set('X-Request-Id', requestId);
    const validation = validateCreateSuppliersPayload(req.body);
    if (validation.errors.length > 0) {
      return res.status(400).json({
        status: 'error',
        requestId,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'The request contains invalid supplier data',
          details: validation.errors
        }
      });
    }
    if (!supplierService?.createMany) {
      return res.status(503).json({
        status: 'error',
        requestId,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Supplier service is not configured'
        }
      });
    }

    try {
      const suppliers = await supplierService.createMany(
        validation.orgid,
        validation.suppliers
      );
      return res.status(201).json({
        status: 'success',
        requestId,
        orgid: validation.orgid,
        insertedCount: suppliers.length,
        suppliers
      });
    } catch (error) {
      error.requestId = requestId;
      return next(error);
    }
  });

  app.post('/wholesale/getcreditedcustomers', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    if (!orgid) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid is required and must contain digits only'
        }
      });
    }
    if (!customerPaymentService?.findCreditedCustomers) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Credited customers service is not configured'
        }
      });
    }

    try {
      const customers = await customerPaymentService.findCreditedCustomers(
        orgid
      );
      res.set('X-Result-Count', String(customers.length));
      return res.status(200).json(customers);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/wholesale/updatecustomerpayment', async (req, res, next) => {
    const orgid = parseOrgid(req.body);
    const customerid = String(req.body?.customerid ?? '').trim();
    const rawPaymentAmount = req.body?.paymentAmount ?? req.body?.paymentamount;
    const paymentAmount = typeof rawPaymentAmount === 'number'
      ? rawPaymentAmount
      : Number(String(rawPaymentAmount ?? '').trim());
    if (!orgid || !/^\d+$/.test(customerid) ||
        !Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({
        status: 'error',
        error: {
          code: 'VALIDATION_ERROR',
          message: 'orgid, numeric customerid, and positive paymentAmount are required'
        }
      });
    }
    if (!customerPaymentService?.updateCustomerPayment) {
      return res.status(503).json({
        status: 'error',
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: 'Update customer payment service is not configured'
        }
      });
    }

    try {
      const result = await customerPaymentService.updateCustomerPayment(
        orgid,
        customerid,
        Math.round((paymentAmount + Number.EPSILON) * 100) / 100
      );
      return res.status(200).json({ status: 'success', orgid, ...result });
    } catch (error) {
      return next(error);
    }
  });

  app.post(
    '/pubsub/wholesale-create-sale-purchase',
    async (req, res, next) => {
      if (!buyerAllocationConsumer) {
        return res.status(503).json({
          error: 'SERVICE_UNAVAILABLE',
          message: 'Buyer allocation consumer is not configured'
        });
      }
      const message = buyerAllocationConsumer.parseMessage(req.body);
      if (!message) {
        return res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Pub/Sub data contains invalid buyer allocation data'
        });
      }

      try {
        const result = await buyerAllocationConsumer.process(message);
        return res.status(200).json({
          status: 'processed',
          insertedCount: result.insertedCount,
          updatedSortingCount: result.updatedSortingCount,
          distributionMessageId: result.distributionMessageId
        });
      } catch (error) {
        return next(error);
      }
    }
  );

  app.post('/pubsub/buyer-allocation-distribution', async (req, res, next) => {
    if (!buyerDistributionConsumer) {
      return res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Buyer distribution consumer is not configured'
      });
    }
    const message = buyerDistributionConsumer.parseMessage(req.body);
    if (!message) {
      return res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Pub/Sub data contains invalid buyer distribution data'
      });
    }

    try {
      const result = await buyerDistributionConsumer.process(message);
      return res.status(200).json({ status: 'processed', ...result });
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

  app.post('/pubsub/update-purchase-sales-response', async (req, res, next) => {
    if (!purchaseSalesResponseConsumer) {
      return res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Purchase sales response consumer is not configured'
      });
    }
    const message = purchaseSalesResponseConsumer.parseMessage(req.body);
    if (!message) {
      const reason = invalidPurchaseSalesResponseReason(req.body);
      console.warn('Ignoring invalid UPDATE_PURCHASE_SALES_RESPONSE message', {
        messageId: req.body?.message?.messageId,
        reason
      });
      return res.status(200).json({
        status: 'ignored',
        reason
      });
    }

    try {
      const result = await purchaseSalesResponseConsumer.process(message);
      return res.status(200).json({ status: 'processed', ...result });
    } catch (error) {
      return next(error);
    }
  });

  app.post('/pubsub/customer-onboarded', async (req, res, next) => {
    if (!tenantProvisioningConsumer) {
      return res.status(503).json({
        error: 'SERVICE_UNAVAILABLE',
        message: 'Tenant provisioning consumer is not configured'
      });
    }

    const message = tenantProvisioningConsumer.parseMessage(req.body);
    if (!message) {
      console.warn('Ignoring invalid CUSTOMER_ONBOARDED message', {
        messageId: req.body?.message?.messageId
      });
      return res.status(200).json({
        status: 'ignored',
        reason: 'Pub/Sub data must contain a numeric orgid'
      });
    }

    try {
      const result = await tenantProvisioningConsumer.process(message);
      return res.status(200).json({ status: 'processed', ...result });
    } catch (error) {
      return next(error);
    }
  });

  app.use((error, req, res, _next) => {
    const requestId = error.requestId || req.requestId || randomUUID();
    res.locals.internalError = {
      code: error.code === undefined ? undefined : String(error.code),
      message: error.message
    };
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
          code: 'RESOURCE_CONFLICT',
          message: 'The requested record conflicts with existing data'
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

    if ([4, 8, 14].includes(error.code)) {
      res.set('Retry-After', '5');
      return res.status(503).json({
        status: 'error',
        requestId,
        error: {
          code: 'PUBSUB_UNAVAILABLE',
          message: 'Pub/Sub is temporarily unavailable'
        }
      });
    }

    if ([5, 7].includes(error.code)) {
      return res.status(503).json({
        status: 'error',
        requestId,
        error: {
          code: 'PUBSUB_CONFIGURATION_ERROR',
          message: 'The Pub/Sub topic or publisher permissions are not configured'
        }
      });
    }

    if (error.code === 'DISCOUNT_NOT_FOUND' ||
        error.code === 'SALES_NOT_FOUND' ||
        error.code === 'SALES_TABLE_NOT_FOUND' ||
        error.code === 'SALES_SUMMARY_NOT_FOUND' ||
        error.code === 'DISCOUNT_TABLE_NOT_FOUND' ||
        error.code === 'PAYMENT_TABLE_NOT_FOUND' ||
        error.code === 'CUSTOMER_PAYMENT_NOT_FOUND' ||
        error.code === 'PURCHASE_SOURCE_ORG_NOT_FOUND' ||
        error.code === 'BUYER_ALLOCATION_NOT_FOUND' ||
        error.code === 'BUYER_ALLOCATION_TABLE_NOT_FOUND' ||
        error.code === 'PURCHASE_NOT_FOUND' ||
        error.code === 'PURCHASE_TABLE_NOT_FOUND' ||
        error.code === 'GROUP_NOT_FOUND' ||
        error.code === 'SUPPLIER_TABLE_NOT_FOUND' ||
        error.code === 'ASSOCIATE_NOT_FOUND') {
      return res.status(404).json({
        status: 'error',
        requestId,
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    if (error.code === 'ASSOCIATE_CONFLICT') {
      return res.status(409).json({
        status: 'error',
        requestId,
        error: {
          code: error.code,
          message: error.message
        }
      });
    }

    if (error.code === 'SUPPLIER_PHONE_CONFLICT') {
      return res.status(409).json({
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

module.exports = {
  createApp,
  parseOrgid,
  requestLoggingMiddleware,
  writeStructuredLog
};
