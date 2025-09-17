/**
 * Product GMV Max – Campaign-level – Hourly breakdown
 * Reads config from the "Config" sheet and writes to "GMVMax_Product_Campaign_Hourly".
 *
 * Prereqs:
 * - Script property TT_ACCESS_TOKEN set to your Access Token
 * - Config sheet with: advertiser_id, store_id, start_date, end_date, (optional) page_size, enable_total_metrics
 */
function runProductGmvMaxCampaignHourly() {
  const cfg = readConfig_();
  validateHourlyRange_(cfg.start_date, cfg.end_date); // must be exactly one day (same date)

  const accessToken = getAccessToken_();
  const endpoint = 'https://business-api.tiktok.com/open_api/v1.3/gmv_max/report/get/';

  // Dimensions for hourly breakdown
  const dimensions = ['campaign_id', 'stat_time_hour'];

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

  const headers = { 'Access-Token': accessToken };
  const pageSize = cfg.page_size || 1000;
  let page = 1;

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
    if (cfg.enable_total_metrics === true) params.enable_total_metrics = true;

    const url = endpoint + '?' + toQueryString_(params);
    const res = UrlFetchApp.fetch(url, { method: 'get', headers, muteHttpExceptions: true });
    const code = res.getResponseCode();
    if (code !== 200) throw new Error('API error HTTP ' + code + ': ' + res.getContentText());

    const body = JSON.parse(res.getContentText());
    if (body.code !== 0) throw new Error('API returned code ' + body.code + ' message: ' + body.message);

    const data = body.data || {};
    const list = data.list || [];

    if (cfg.enable_total_metrics === true && body.total_metrics && !totalMetrics) {
      totalMetrics = body.total_metrics;
    }

    list.forEach(item => {
      const d = item.dimensions || {};
      const m = item.metrics || {};
      allRows.push({
        advertiser_id: String(cfg.advertiser_id),
        store_id: String(cfg.store_id),
        stat_time_hour: d.stat_time_hour || '',  // e.g. "2025-09-03 14:00:00"
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

  writeRowsToSheet_('GMVMax_Product_Campaign_Hourly', allRows, [
    'advertiser_id',
    'store_id',
    'stat_time_hour',
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
    writeTotalsSheet_('GMVMax_Product_Campaign_Hourly_Totals', totalMetrics);
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

function validateHourlyRange_(startDateStr, endDateStr) {
  // Hourly breakdown supports up to one day → enforce same date
  if (String(startDateStr) !== String(endDateStr)) {
    throw new Error('Hourly breakdown requires start_date == end_date (one calendar day).');
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

  sh.clearContents();
  sh.getRange(1, 1, 1, headerOrder.length).setValues([headerOrder]);

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
