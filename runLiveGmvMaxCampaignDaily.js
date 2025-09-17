/**
 * LIVE GMV Max – Campaign-level – Daily breakdown (from 2025-06-01 to today)
 * Dimensions: ["campaign_id","stat_time_day"]
 * Metrics: campaign attributes + performance + LIVE engagement metrics
 * Output:
 *   - Data   -> "GMVMax_LIVE_Campaign_Daily_Since_2025-06-01"
 *   - Totals -> "GMVMax_LIVE_Campaign_Daily_Totals_Since_2025-06-01"
 */
function runLiveGmvMaxCampaignDaily_SinceJune1_Simple() {
  // ==== EDIT THESE IF NEEDED ====
  const ADVERTISER_IDS = [
    "7064472113809195009"
  ];

  const STORE_IDS = [
    "7493999781643847575"
  ];

  // Use Script Properties -> TT_ACCESS_TOKEN (or hardcode a string here)
  const ACCESS_TOKEN = PropertiesService.getScriptProperties().getProperty('TT_ACCESS_TOKEN');
  if (!ACCESS_TOKEN) throw new Error('Missing TT_ACCESS_TOKEN in Script Properties (or hardcode ACCESS_TOKEN).');

  // ====== Date range: 2025-06-01 .. today (Asia/Jakarta), sliced into ≤30-day windows ======
  const TZ = 'Asia/Jakarta';
  const START_FIXED = '2025-06-01';
  const todayStr = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');

  const windows = buildDailyWindows_(START_FIXED, todayStr, TZ); // array of [startStr, endStr] (each ≤30 days)

  // Pair advertisers & stores: either one store for all, or equal-length lists
  let pairs = [];
  if (STORE_IDS.length === 1) {
    pairs = ADVERTISER_IDS.map(a => ({ advertiser_id: a, store_id: STORE_IDS[0] }));
  } else if (ADVERTISER_IDS.length === STORE_IDS.length) {
    pairs = ADVERTISER_IDS.map((a, i) => ({ advertiser_id: a, store_id: STORE_IDS[i] }));
  } else {
    throw new Error('List mismatch: provide one store for all advertisers OR equal counts.');
  }

  // ====== API setup ======
  const endpoint = 'https://business-api.tiktok.com/open_api/v1.3/gmv_max/report/get/';
  const headers = { 'Access-Token': ACCESS_TOKEN };
  const pageSize = 1000;
  const ENABLE_TOTAL_METRICS = true;

  // Daily breakdown at campaign level
  const dimensions = ['campaign_id', 'stat_time_day'];

  // Your chosen metrics: attributes + performance + LIVE engagement
  const metrics = [
    // Attributes
    'campaign_id',
    'operation_status',
    'campaign_name',
    'tt_account_name',
    'tt_account_profile_image_url',
    'identity_id',
    'schedule_type',
    'schedule_start_time',
    'schedule_end_time',
    'bid_type',
    'target_roi_budget',
    'max_delivery_budget',
    'roas_bid',
    // Performance
    'cost',
    'net_cost',
    'orders',
    'cost_per_order',
    'gross_revenue',
    'roi',
    // LIVE engagement
    'live_views',
    'cost_per_live_view',
    '10_second_live_views',
    'cost_per_10_second_live_view',
    'live_follows'
  ];

  const filtering = { gmv_max_promotion_types: ['LIVE'] };

  // Accumulators
  const allRows = [];
  let totalsAgg = {};

  // ====== Fetch for each advertiser/store pair & window ======
  windows.forEach(([START_DATE, END_DATE]) => {
    pairs.forEach(({ advertiser_id, store_id }) => {
      let page = 1;
      try {
        while (true) {
          const params = {
            advertiser_id: String(advertiser_id),
            store_ids: JSON.stringify([String(store_id)]),
            start_date: START_DATE,
            end_date: END_DATE,
            dimensions: JSON.stringify(dimensions),
            metrics: JSON.stringify(metrics),
            filtering: JSON.stringify(filtering),
            page,
            page_size: pageSize
          };
          if (ENABLE_TOTAL_METRICS) params.enable_total_metrics = true;

          const url = endpoint + '?' + toQueryString_(params);
          const res = UrlFetchApp.fetch(url, { method: 'get', headers, muteHttpExceptions: true });
          if (res.getResponseCode() !== 200) {
            throw new Error(`HTTP ${res.getResponseCode()} – ${res.getContentText()}`);
          }

          const body = JSON.parse(res.getContentText());
          if (body.code !== 0) throw new Error(`API code ${body.code} – ${body.message}`);

          // Merge totals from this slice
          if (ENABLE_TOTAL_METRICS && body.total_metrics) {
            totalsAgg = sumTotals_(totalsAgg, body.total_metrics);
          }

          const data = body.data || {};
          const list = data.list || [];

          list.forEach(item => {
            const d = item.dimensions || {};
            const m = item.metrics || {};
            allRows.push({
              advertiser_id: String(advertiser_id),
              store_id: String(store_id),
              stat_time_day: d.stat_time_day || '',
              campaign_id: d.campaign_id || '',
              // Attributes
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
              // Performance
              cost: m.cost || '',
              net_cost: m.net_cost || '',
              orders: m.orders || '',
              cost_per_order: m.cost_per_order || '',
              gross_revenue: m.gross_revenue || '',
              roi: m.roi || '',
              // LIVE engagement (renamed for nicer headers)
              live_views: m.live_views || '',
              cost_per_live_view: m.cost_per_live_view || '',
              live_10s_views: m['10_second_live_views'] || '',
              cost_per_10s_live_view: m['cost_per_10_second_live_view'] || '',
              live_follows: m.live_follows || ''
            });
          });

          const pageInfo = data.page_info || {};
          if (page >= Number(pageInfo.total_page || 1)) break;
          page++;
        }
      } catch (err) {
        logErrorRow_('GMVMax_Errors', {
          ts: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'),
          advertiser_id,
          store_id,
          window: `${START_DATE}..${END_DATE}`,
          message: String(err && err.message || err)
        });
      }
    });
  });

  // Optional: recompute overall ROI from aggregated totals
  if (totalsAgg) {
    const cost = num_(totalsAgg.cost);
    const gross = num_(totalsAgg.gross_revenue);
    if (isFinite(cost) && cost > 0 && isFinite(gross)) {
      totalsAgg.roi = gross / cost;
    }
    const netCost = num_(totalsAgg.net_cost);
    if ((!isFinite(cost) || cost === 0) && isFinite(netCost) && netCost > 0 && isFinite(gross)) {
      totalsAgg.roi = gross / netCost;
    }
  }

  // ====== Write sheets ======
  writeRowsToSheet_('GMVMax_LIVE_Campaign_Daily_Since_2025-06-01', allRows, [
    'advertiser_id',
    'store_id',
    'stat_time_day',
    'campaign_id',
    'operation_status',
    'campaign_name',
    'tt_account_name',
    'tt_account_profile_image_url',
    'identity_id',
    'schedule_type',
    'schedule_start_time',
    'schedule_end_time',
    'bid_type',
    'target_roi_budget',
    'max_delivery_budget',
    'roas_bid',
    'cost',
    'net_cost',
    'orders',
    'cost_per_order',
    'gross_revenue',
    'roi',
    'live_views',
    'cost_per_live_view',
    'live_10s_views',
    'cost_per_10s_live_view',
    'live_follows'
  ]);

  if (ENABLE_TOTAL_METRICS && totalsAgg && Object.keys(totalsAgg).length) {
    writeTotalsSheet_('GMVMax_LIVE_Campaign_Daily_Totals_Since_2025-06-01', totalsAgg);
  }
}

/* ===================== Minimal helpers (same as before) ===================== */

// Build ≤30-day daily windows from start..end (inclusive)
function buildDailyWindows_(startDateStr, endDateStr, tz) {
  const msDay = 24 * 60 * 60 * 1000;
  const start = new Date(startDateStr + 'T00:00:00');
  const end = new Date(endDateStr + 'T00:00:00');
  const out = [];
  let curStart = new Date(start);
  while (curStart <= end) {
    const curEnd = new Date(Math.min(end.getTime(), curStart.getTime() + 29 * msDay)); // ≤30 days
    out.push([
      Utilities.formatDate(curStart, tz, 'yyyy-MM-dd'),
      Utilities.formatDate(curEnd, tz, 'yyyy-MM-dd')
    ]);
    curStart = new Date(curEnd.getTime() + msDay);
  }
  return out;
}

// Sum numeric fields across totals objects (strings/numbers ok)
function sumTotals_(agg, add) {
  const out = Object.assign({}, agg);
  Object.keys(add || {}).forEach(k => {
    const v = num_(add[k]);
    if (isFinite(v)) {
      out[k] = (num_(out[k]) || 0) + v;
    } else if (!(k in out)) {
      out[k] = add[k]; // carry through non-numeric (e.g., currency)
    }
  });
  return out;
}
function num_(x) {
  const n = typeof x === 'string' ? parseFloat(x) : Number(x);
  return isNaN(n) ? NaN : n;
}

function toQueryString_(params) {
  const parts = [];
  Object.keys(params).forEach(k => {
    const v = params[k];
    if (v === undefined || v === null) return;
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(String(v)));
  });
  return parts.join('&');
}

function writeRowsToSheet_(sheetName, rows, columns) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sh.clearContents();

  // Header
  sh.getRange(1, 1, 1, columns.length).setValues([columns]);

  if (!rows || rows.length === 0) return;

  // Data
  const data = rows.map(r => columns.map(c => r[c] !== undefined ? r[c] : ''));
  sh.getRange(2, 1, data.length, columns.length).setValues(data);
}

function writeTotalsSheet_(sheetName, totals) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sh.clearContents();

  const keys = Object.keys(totals);
  sh.getRange(1, 1, 1, keys.length).setValues([keys]);
  sh.getRange(2, 1, 1, keys.length).setValues([keys.map(k => totals[k])]);
}

function logErrorRow_(sheetName, obj) {
  const keys = ['ts', 'advertiser_id', 'store_id', 'window', 'message'];
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);

  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, keys.length).setValues([keys]);
  }
  sh.appendRow(keys.map(k => obj[k] || ''));
}
