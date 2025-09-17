/**
 * Product GMV Max – Creative-level (statuses mode, no daily breakdown)
 * Dimensions: ["campaign_id","item_group_id","item_id"]
 * Filters: campaign_ids (one+), item_group_ids (one+), optional creative_delivery_statuses
 * Metrics: creative_delivery_status + performance/funnel
 *
 * Output:
 *  - Data  -> "GMVMax_Product_Creative_Statuses"
 *  - Totals (opt) -> "GMVMax_Product_Creative_Statuses_Totals"
 */
function runProductGmvMaxCreativeStatuses() {
  const cfg = readConfigCreativeStatuses_();              // ✅ read DISPLAY values (strings)
  const accessToken = getAccessToken_();                  // ✅ from Script Properties (TT_ACCESS_TOKEN)
  const endpoint = 'https://business-api.tiktok.com/open_api/v1.3/gmv_max/report/get/';

  const dimensions = ['campaign_id', 'item_group_id', 'item_id'];

  const metrics = [
    'creative_delivery_status',
    'cost','orders','cost_per_order','gross_revenue','roi',
    'product_impressions','product_clicks','product_click_rate',
    'ad_click_rate','ad_conversion_rate',
    'ad_video_view_rate_2s','ad_video_view_rate_6s',
    'ad_video_view_rate_p25','ad_video_view_rate_p50','ad_video_view_rate_p75','ad_video_view_rate_p100'
  ];

  const filtering = {
    campaign_ids: cfg.campaign_ids,       // array of strings
    item_group_ids: cfg.item_group_ids    // array of strings
  };
  if (cfg.creative_delivery_statuses.length > 0) {
    filtering.creative_delivery_statuses = cfg.creative_delivery_statuses;
  }

  const headers = { 'Access-Token': accessToken };
  const pageSize = cfg.page_size || 1000;
  let page = 1;

  const allRows = [];
  let totalMetrics = null;

  while (true) {
    const params = {
      advertiser_id: String(cfg.advertiser_id),                       // single string
      store_ids: JSON.stringify([String(cfg.store_id)]),              // ["<one store id>"]
      start_date: cfg.start_date,                                     // "YYYY-MM-DD"
      end_date: cfg.end_date,                                         // "YYYY-MM-DD"
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
    if (code !== 200) throw new Error('HTTP ' + code + ': ' + res.getContentText());

    const body = JSON.parse(res.getContentText());
    if (body.code !== 0) throw new Error('API ' + body.code + ': ' + body.message);

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
        campaign_id: d.campaign_id || '',
        item_group_id: d.item_group_id || '',
        item_id: d.item_id || '',
        creative_delivery_status: m.creative_delivery_status || '',
        cost: m.cost || '',
        orders: m.orders || '',
        cost_per_order: m.cost_per_order || '',
        gross_revenue: m.gross_revenue || '',
        roi: m.roi || '',
        product_impressions: m.product_impressions || '',
        product_clicks: m.product_clicks || '',
        product_click_rate: m.product_click_rate || '',
        ad_click_rate: m.ad_click_rate || '',
        ad_conversion_rate: m.ad_conversion_rate || '',
        ad_video_view_rate_2s: m.ad_video_view_rate_2s || '',
        ad_video_view_rate_6s: m.ad_video_view_rate_6s || '',
        ad_video_view_rate_p25: m.ad_video_view_rate_p25 || '',
        ad_video_view_rate_p50: m.ad_video_view_rate_p50 || '',
        ad_video_view_rate_p75: m.ad_video_view_rate_p75 || '',
        ad_video_view_rate_p100: m.ad_video_view_rate_p100 || ''
      });
    });

    const pageInfo = data.page_info || {};
    const totalPage = Number(pageInfo.total_page || 1);
    if (page >= totalPage) break;
    page++;
  }

  writeRowsToSheet_('GMVMax_Product_Creative_Statuses', allRows, [
    'advertiser_id','store_id','campaign_id','item_group_id','item_id',
    'creative_delivery_status','cost','orders','cost_per_order','gross_revenue','roi',
    'product_impressions','product_clicks','product_click_rate',
    'ad_click_rate','ad_conversion_rate',
    'ad_video_view_rate_2s','ad_video_view_rate_6s',
    'ad_video_view_rate_p25','ad_video_view_rate_p50','ad_video_view_rate_p75','ad_video_view_rate_p100'
  ]);

  if (cfg.enable_total_metrics === true && totalMetrics) {
    writeTotalsSheet_('GMVMax_Product_Creative_Statuses_Totals', totalMetrics);
  }
}

/** ---------------- Helpers (same style as #1–#3) ---------------- */

function readConfigCreativeStatuses_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Config');
  if (!sh) throw new Error('Missing "Config" sheet.');

  // Use DISPLAY values to avoid date serials and to keep strings as typed.
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  if (values.length < 2) throw new Error('Config needs headers row (1) + values row (2).');

  const headers = values[0].map(h => String(h).trim());
  const row = values[1];
  const asMap = {};
  headers.forEach((h, i) => asMap[h] = (row[i] || '').toString().trim());

  // Prefer Config.advertiser_id; fallback to Script Property TT_ADVERTISER_IDS (first if CSV)
  let advertiser_id = asMap.advertiser_id;
  if (!advertiser_id) {
    const prop = PropertiesService.getScriptProperties().getProperty('TT_ADVERTISER_IDS') || '';
    advertiser_id = prop.split(',')[0].trim(); // take first ID only
  }

  const store_id = asMap.store_id;
  const start_date = asMap.start_date;
  const end_date = asMap.end_date;

  // Parse CSV into arrays of strings
  const campaign_ids = (asMap.campaign_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  const item_group_ids = (asMap.item_group_ids || '').split(',').map(s => s.trim()).filter(Boolean);
  const creative_delivery_statuses = (asMap.creative_delivery_statuses || '').split(',').map(s => s.trim()).filter(Boolean);

  if (!advertiser_id) throw new Error('Missing advertiser_id (Config or TT_ADVERTISER_IDS).');
  if (!store_id) throw new Error('Missing store_id in Config.');
  if (!start_date || !end_date) throw new Error('Missing start_date / end_date in Config.');
  if (campaign_ids.length === 0) throw new Error('Provide at least one campaign_id in Config.');
  if (item_group_ids.length === 0) throw new Error('Provide at least one item_group_id in Config.');

  const page_size = asMap.page_size ? Number(asMap.page_size) : undefined;
  const enable_total_metrics = String(asMap.enable_total_metrics || '').toUpperCase() === 'TRUE';

  return {
    advertiser_id,
    store_id,
    start_date,
    end_date,
    campaign_ids,
    item_group_ids,
    creative_delivery_statuses,
    page_size,
    enable_total_metrics
  };
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
