/**
 * Product GMV Max – Campaign-level – Daily breakdown
 * Reads config from the "Config" sheet and writes to "GMVMax_Product_Campaign_Daily".
 *
 * Prereqs:
 * - Script property TT_ACCESS_TOKEN set to your Access Token
 * - Config sheet with: advertiser_id, store_id, start_date, end_date, (optional) page_size, enable_total_metrics
 *
 * API spec references:
 * - Endpoint, headers, params, dimensions, filters, pagination: Run a GMV Max Campaign report
 * - Metrics at Product GMV Max campaign-level: Metrics in GMV Max Campaign reports
 */
function runProductGmvMaxCampaignDaily() {
  const cfg = readConfig_();
  validateDailyRange_(cfg.start_date, cfg.end_date); // ≤ 30 days per stat_time_day

  const accessToken = getAccessToken_();
  const endpoint = 'https://business-api.tiktok.com/open_api/v1.3/gmv_max/report/get/';

  // Dimensions for daily breakdown
  const dimensions = ['campaign_id', 'stat_time_day'];

  // All available Product GMV Max campaign-level metrics (attributes + performance)
  const metrics = [
    // Attributes
    'campaign_id',
    'operation_status',
    'campaign_name',
    'schedule_type',
    'schedule_start_time',
    'schedule_end_time',
    'target_roi_budget',
    'bid_type',
    'max_delivery_budget',
    'roas_bid',
    // Performance
    'cost',
    'net_cost',
    'orders',
    'cost_per_order',
    'gross_revenue',
    'roi'
  ];

  // Filtering for Product GMV Max
  const filtering = {
    gmv_max_promotion_types: ['PRODUCT']
  };

  const pageSize = cfg.page_size || 1000;
  let page = 1;

  const headers = {
    'Access-Token': accessToken
  };

  const allRows = [];
  let totalMetrics = null;

  while (true) {
    const params = {
      advertiser_id: String(cfg.advertiser_id),
      store_ids: JSON.stringify([String(cfg.store_id)]),
      start_date: cfg.start_date,
      end_date: cfg.end_date,
      dimensions: JSON.stringify(dimensions),
      metrics: JSON.stringify(metrics),
      filtering: JSON.stringify(filtering),
      page: page,
      page_size: pageSize
    };

    if (cfg.enable_total_metrics === true) {
      params.enable_total_metrics = true;
    }

    const url = endpoint + '?' + toQueryString_(params);
    const res = UrlFetchApp.fetch(url, { method: 'get', headers, muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code !== 200) {
      throw new Error('API error HTTP ' + code + ': ' + res.getContentText());
    }

    const body = JSON.parse(res.getContentText());
    if (body.code !== 0) {
      throw new Error('API returned code ' + body.code + ' message: ' + body.message);
    }

    const data = body.data || {};
    const list = data.list || [];

    // capture total_metrics once if enabled
    if (cfg.enable_total_metrics === true && body.total_metrics && !totalMetrics) {
      totalMetrics = body.total_metrics;
    }

    // Flatten each record into a row object
    list.forEach(item => {
      const d = item.dimensions || {};
      const m = item.metrics || {};
      allRows.push({
        advertiser_id: String(cfg.advertiser_id),
        store_id: String(cfg.store_id),
        stat_time_day: d.stat_time_day || '',
        campaign_id: d.campaign_id || '',
        // Attributes
        operation_status: m.operation_status || '',
        campaign_name: m.campaign_name || '',
        schedule_type: m.schedule_type || '',
        schedule_start_time: m.schedule_start_time || '',
        schedule_end_time: m.schedule_end_time || '',
        target_roi_budget: m.target_roi_budget || '',
        bid_type: m.bid_type || '',
        max_delivery_budget: m.max_delivery_budget || '',
        roas_bid: m.roas_bid || '',
        // Performance
        cost: m.cost || '',
        net_cost: m.net_cost || '',
        orders: m.orders || '',
        cost_per_order: m.cost_per_order || '',
        gross_revenue: m.gross_revenue || '',
        roi: m.roi || ''
      });
    });

    const pageInfo = data.page_info || {};
    const totalPage = Number(pageInfo.total_page || 1);
    if (page >= totalPage) break;
    page++;
  }

  writeRowsToSheet_('GMVMax_Product_Campaign_Daily', allRows, [
    'advertiser_id',
    'store_id',
    'stat_time_day',
    'campaign_id',
    'operation_status',
    'campaign_name',
    'schedule_type',
    'schedule_start_time',
    'schedule_end_time',
    'target_roi_budget',
    'bid_type',
    'max_delivery_budget',
    'roas_bid',
    'cost',
    'net_cost',
    'orders',
    'cost_per_order',
    'gross_revenue',
    'roi'
  ]);

  if (cfg.enable_total_metrics === true && totalMetrics) {
    writeTotalsSheet_('GMVMax_Product_Campaign_Daily_Totals', totalMetrics);
  }
}

/** ---------------- Helpers ---------------- */

function readConfig_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Config');
  if (!sh) throw new Error('Missing "Config" sheet.');
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  if (values.length < 2) throw new Error('Config sheet must have headers in row 1 and values in row 2.');

  const headers = values[0].map(h => String(h).trim());
  const row = values[1];

  const asMap = {};
  headers.forEach((h, i) => asMap[h] = row[i]);

  // Fallbacks: you mentioned TT_ADVERTISER_IDS etc., but we use explicit config first.
  const props = PropertiesService.getScriptProperties();
  const advertiser_id = asMap.advertiser_id || props.getProperty('TT_ADVERTISER_IDS');
  const store_id = asMap.store_id;
  const start_date = asMap.start_date;
  const end_date = asMap.end_date;

  if (!advertiser_id) throw new Error('Missing advertiser_id (Config or TT_ADVERTISER_IDS).');
  if (!store_id) throw new Error('Missing store_id in Config.');
  if (!start_date || !end_date) throw new Error('Missing start_date/end_date in Config.');

  const page_size = asMap.page_size ? Number(asMap.page_size) : undefined;
  const enable_total_metrics = String(asMap.enable_total_metrics || '').toUpperCase() === 'TRUE';

  return {
    advertiser_id,
    store_id,
    start_date,
    end_date,
    page_size,
    enable_total_metrics
  };
}

function validateDailyRange_(startDateStr, endDateStr) {
  const start = new Date(startDateStr + 'T00:00:00Z');
  const end = new Date(endDateStr + 'T00:00:00Z');
  const msInDay = 24 * 60 * 60 * 1000;
  const days = Math.floor((end - start) / msInDay) + 1;
  if (days > 30) {
    throw new Error('Daily breakdown window must be ≤ 30 days when using stat_time_day.');
  }
}

function getAccessToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('TT_ACCESS_TOKEN');
  if (!token) throw new Error('Missing TT_ACCESS_TOKEN in Script Properties.');
  return token;
}

function toQueryString_(params) {
  return Object.keys(params)
    .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&');
}

function writeRowsToSheet_(sheetName, rows, headerOrder) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);

  // Clear and write headers
  sh.clearContents();
  sh.getRange(1, 1, 1, headerOrder.length).setValues([headerOrder]);

  // Write data
  const data = rows.map(r => headerOrder.map(h => r[h] ?? ''));
  if (data.length > 0) {
    sh.getRange(2, 1, data.length, headerOrder.length).setValues(data);
  }
}

function writeTotalsSheet_(sheetName, totals) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  sh.clearContents();

  const keys = Object.keys(totals);
  sh.getRange(1, 1, 1, keys.length).setValues([keys]);
  sh.getRange(2, 1, 1, keys.length).setValues([keys.map(k => totals[k])]);
}
