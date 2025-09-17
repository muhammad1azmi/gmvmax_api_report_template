/**
 * Product GMV Max – Product-level – Daily breakdown (with product attributes)
 * FIX: remove gmv_max_promotion_types from filtering (not supported at product-level).
 * Requires: single campaign_id in Config and one ID dimension (item_group_id).
 *
 * Output:
 * - Data -> "GMVMax_Product_ProductLevel_Daily"
 * - Totals (optional) -> "GMVMax_Product_ProductLevel_Daily_Totals"
 */
function runProductGmvMaxProductDaily() {
  const cfg = readConfig_ProductSingleCampaign_();
  validateDailyRange_(cfg.start_date, cfg.end_date); // ≤ 30 days

  const accessToken = getAccessToken_();
  const endpoint = 'https://business-api.tiktok.com/open_api/v1.3/gmv_max/report/get/';

  // One ID dimension so attributes are allowed
  const dimensions = ['item_group_id', 'stat_time_day'];

  // Product-level attributes + performance
  const metrics = [
    // Attributes
    'product_name',
    'product_image_url',
    'product_status',  // available | unavailable
    'bid_type',        // CUSTOM | NO_BID
    // Performance
    'cost',
    'orders',
    'cost_per_order',
    'gross_revenue',
    'roi'
  ];

  // Product-level filtering: single campaign_id only (no gmv_max_promotion_types here)
  const filtering = {
    campaign_ids: [cfg.campaign_id]
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
        campaign_id: cfg.campaign_id,      // constant from filter
        stat_time_day: d.stat_time_day || '',
        item_group_id: d.item_group_id || '',
        // Attributes
        product_name: m.product_name || '',
        product_image_url: m.product_image_url || '',
        product_status: m.product_status || '',
        bid_type: m.bid_type || '',
        // Performance
        cost: m.cost || '',
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

  writeRowsToSheet_('GMVMax_Product_ProductLevel_Daily', allRows, [
    'advertiser_id',
    'store_id',
    'campaign_id',
    'stat_time_day',
    'item_group_id',
    'product_name',
    'product_image_url',
    'product_status',
    'bid_type',
    'cost',
    'orders',
    'cost_per_order',
    'gross_revenue',
    'roi'
  ]);

  if (cfg.enable_total_metrics === true && totalMetrics) {
    writeTotalsSheet_('GMVMax_Product_ProductLevel_Daily_Totals', totalMetrics);
  }
}

/** ---------------- Helpers (same as before) ---------------- */

function readConfig_ProductSingleCampaign_() {
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

  const campaignIdsStr = (asMap.campaign_ids || '').trim();
  const arr = campaignIdsStr ? campaignIdsStr.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (arr.length !== 1) {
    throw new Error(
      'To include product_name and other product attributes, set exactly ONE campaign_id in Config.campaign_ids. ' +
      'For multi-campaign pulls, remove attributes and use performance-only with dimensions ' +
      '["campaign_id","item_group_id","stat_time_day"].'
    );
  }
  const campaign_id = arr[0];

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
    campaign_id,
    page_size,
    enable_total_metrics
  };
}

function validateDailyRange_(startDateStr, endDateStr) {
  const start = new Date(startDateStr + 'T00:00:00Z');
  const end = new Date(endDateStr + 'T00:00:00Z');
  const msInDay = 24 * 60 * 60 * 1000;
  const days = Math.floor((end - start) / msInDay) + 1;
  if (days > 30) throw new Error('Daily breakdown window must be ≤ 30 days when using stat_time_day.');
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
  if (data.length > 0) sh.getRange(2, 1, data.length, headerOrder.length).setValues(data);
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
