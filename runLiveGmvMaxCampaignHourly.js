/**
 * LIVE GMV Max – Campaign-level – Hourly breakdown
 * Output:
 *   - Data   -> "GMVMax_LIVE_Campaign_Hourly"
 *   - Totals -> "GMVMax_LIVE_Campaign_Hourly_Totals" (if enable_total_metrics = TRUE)
 */
function runLiveGmvMaxCampaignHourly() {
  const cfg = readConfigLiveHourly_();          // self-contained config reader
  validateHourlyRange_(cfg.start_date, cfg.end_date);

  const accessToken = getAccessToken_();
  const endpoint = 'https://business-api.tiktok.com/open_api/v1.3/gmv_max/report/get/';

  const dimensions = ['campaign_id', 'stat_time_hour'];

  const metrics = [
    // Attributes
    'campaign_id','operation_status','campaign_name',
    'tt_account_name','tt_account_profile_image_url','identity_id',
    'schedule_type','schedule_start_time','schedule_end_time',
    'bid_type','target_roi_budget','max_delivery_budget','roas_bid',
    // Performance
    'cost','net_cost','orders','cost_per_order','gross_revenue','roi',
    // LIVE engagement
    'live_views','cost_per_live_view','10_second_live_views',
    'cost_per_10_second_live_view','live_follows'
  ];

  const filtering = { gmv_max_promotion_types: ['LIVE'] };

  const headers = { 'Access-Token': accessToken };
  const pageSize = cfg.page_size || 1000;
  let page = 1, allRows = [], totalMetrics = null;

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
    if (cfg.enable_total_metrics) params.enable_total_metrics = true;

    const url = endpoint + '?' + toQueryString_(params);
    const res = UrlFetchApp.fetch(url, { method: 'get', headers, muteHttpExceptions: true });
    if (res.getResponseCode() !== 200) throw new Error('HTTP ' + res.getResponseCode() + ': ' + res.getContentText());

    const body = JSON.parse(res.getContentText());
    if (body.code !== 0) throw new Error('API ' + body.code + ': ' + body.message);

    const data = body.data || {};
    const list = data.list || [];

    if (cfg.enable_total_metrics && body.total_metrics && !totalMetrics) {
      totalMetrics = body.total_metrics;
    }

    list.forEach(item => {
      const d = item.dimensions || {}, m = item.metrics || {};
      allRows.push({
        advertiser_id: cfg.advertiser_id,
        store_id: cfg.store_id,
        stat_time_hour: d.stat_time_hour || '',
        campaign_id: d.campaign_id || '',
        operation_status: m.operation_status || '',
        campaign_name: m.campaign_name || '',
        tt_account_name: m.tt_account_name || '',
        tt_account_profile_image_url: m.tt_account_profile_image_url || '',
        identity_id: m.identity_id || '',
        schedule_type: m.schedule_type || '',
        schedule_start_time: m.schedule_start_time || '',
        schedule_end_time: m.schedule_end_time || '',
        bid_type: m.bid_type || '',
        target_roi_budget: m.target_roi_budget || '',
        max_delivery_budget: m.max_delivery_budget || '',
        roas_bid: m.roas_bid || '',
        cost: m.cost || '',
        net_cost: m.net_cost || '',
        orders: m.orders || '',
        cost_per_order: m.cost_per_order || '',
        gross_revenue: m.gross_revenue || '',
        roi: m.roi || '',
        live_views: m.live_views || '',
        cost_per_live_view: m.cost_per_live_view || '',
        live_10s_views: m['10_second_live_views'] || '',
        cost_per_10s_live_view: m['cost_per_10_second_live_view'] || '',
        live_follows: m.live_follows || ''
      });
    });

    if (page >= Number((data.page_info || {}).total_page || 1)) break;
    page++;
  }

  writeRowsToSheet_('GMVMax_LIVE_Campaign_Hourly', allRows, [
    'advertiser_id','store_id','stat_time_hour','campaign_id',
    'operation_status','campaign_name','tt_account_name','tt_account_profile_image_url',
    'identity_id','schedule_type','schedule_start_time','schedule_end_time',
    'bid_type','target_roi_budget','max_delivery_budget','roas_bid',
    'cost','net_cost','orders','cost_per_order','gross_revenue','roi',
    'live_views','cost_per_live_view','live_10s_views','cost_per_10s_live_view','live_follows'
  ]);

  if (cfg.enable_total_metrics && totalMetrics) {
    writeTotalsSheet_('GMVMax_LIVE_Campaign_Hourly_Totals', totalMetrics);
  }
}

/** ---------- Helpers ---------- */
function readConfigLiveHourly_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Config');
  if (!sh) throw new Error('Missing "Config" sheet.');
  const values = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  if (values.length < 2) throw new Error('Config needs headers row 1 + values row 2.');
  const headers = values[0].map(h => String(h).trim());
  const row = values[1], asMap = {};
  headers.forEach((h, i) => asMap[h] = (row[i] || '').toString().trim());

  let advertiser_id = asMap.advertiser_id;
  if (!advertiser_id) {
    const prop = PropertiesService.getScriptProperties().getProperty('TT_ADVERTISER_IDS') || '';
    advertiser_id = prop.split(',')[0].trim();
  }

  if (!advertiser_id) throw new Error('Missing advertiser_id.');
  if (!asMap.store_id) throw new Error('Missing store_id in Config.');
  if (!asMap.start_date || !asMap.end_date) throw new Error('Missing start_date/end_date in Config.');

  return {
    advertiser_id,
    store_id: asMap.store_id,
    start_date: asMap.start_date,
    end_date: asMap.end_date,
    page_size: asMap.page_size ? Number(asMap.page_size) : undefined,
    enable_total_metrics: String(asMap.enable_total_metrics || '').toUpperCase() === 'TRUE'
  };
}

function validateHourlyRange_(startDateStr, endDateStr) {
  if (String(startDateStr) !== String(endDateStr)) {
    throw new Error('Hourly breakdown requires start_date == end_date (one day).');
  }
}

function getAccessToken_() {
  const token = PropertiesService.getScriptProperties().getProperty('TT_ACCESS_TOKEN');
  if (!token) throw new Error('Missing TT_ACCESS_TOKEN in Script Properties.');
  return token;
}

function toQueryString_(params) {
  return Object.keys(params).map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k])).join('&');
}

function writeRowsToSheet_(sheetName, rows, headerOrder) {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(sheetName);
  if (!sh) sh = ss.insertSheet(sheetName);
  sh.clearContents();
  sh.getRange(1, 1, 1, headerOrder.length).setValues([headerOrder]);
  if (rows.length > 0) {
    sh.getRange(2, 1, rows.length, headerOrder.length).setValues(rows.map(r => headerOrder.map(h => r[h] ?? '')));
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
