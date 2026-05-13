const express = require('express');
const router = express.Router();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const pinyin = require('tiny-pinyin');

let stockListCache = [];
let fundListCache = [];
let fundRefreshPromise = null;
let fundListFetchedAt = 0;

const FUND_LIST_URL = 'https://fund.eastmoney.com/js/fundcode_search.js';
const FUND_REFRESH_INTERVAL = 12 * 60 * 60 * 1000;
const EXCHANGE_ETF_CODE = /^(159|510|511|512|513|515|516|517|518|519|560|561|562|563|588|589)\d{3}$/;

function addPinyinToStock(stock) {
  if (pinyin.isSupported() && stock.name) {
    const fullPinyin = pinyin.convertToPinyin(stock.name, '-', true);
    const abbr = fullPinyin.split('-').map(p => p[0]).join('');
    stock.py = fullPinyin.replace(/-/g, '');
    stock.pinyin = abbr;
  }
  return stock;
}

function readJsonList(fileName) {
  try {
    const filePath = path.join(__dirname, '..', fileName);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error('Read ' + fileName + ' failed:', e.message);
    return [];
  }
}

function normalizeFund(row) {
  return addPinyinToStock({
    code: String(row.code || row[0] || '').trim(),
    abbr: String(row.abbr || row[1] || '').trim(),
    name: String(row.name || row[2] || '').trim(),
    fundType: row.fundType || row[3] || '',
    type: 'fund'
  });
}

function isExchangeEtf(fund) {
  return EXCHANGE_ETF_CODE.test(fund.code) && /ETF/i.test(fund.name);
}

function parseEastmoneyFundList(text) {
  const normalizedText = String(text || '').replace(/^\uFEFF/, '');
  const match = normalizedText.match(/var\s+r\s*=\s*(\[[\s\S]*\]);?\s*$/);
  if (!match) throw new Error('Eastmoney fund list format changed');
  return JSON.parse(match[1].replace(/;\s*$/, ''))
    .map(normalizeFund)
    .filter(isExchangeEtf);
}

async function refreshFundList() {
  const resp = await axios.get(FUND_LIST_URL, {
    responseType: 'arraybuffer',
    timeout: 8000,
    headers: { 'User-Agent': 'Mozilla/5.0' }
  });
  fundListCache = parseEastmoneyFundList(Buffer.from(resp.data).toString('utf8'));
  fundListFetchedAt = Date.now();
  console.log('ETF fund count:', fundListCache.length);
}

function scheduleFundRefresh() {
  const stale = !fundListFetchedAt || Date.now() - fundListFetchedAt > FUND_REFRESH_INTERVAL;
  if (!stale || fundRefreshPromise) return;
  fundRefreshPromise = refreshFundList()
    .catch(function(e) {
      console.warn('Refresh ETF fund list failed:', e.message);
    })
    .finally(function() {
      fundRefreshPromise = null;
    });
}

function getMergedStockList() {
  const seen = new Set();
  return stockListCache.concat(fundListCache).filter(function(item) {
    if (!item.code || seen.has(item.code)) return false;
    seen.add(item.code);
    return true;
  });
}

stockListCache = readJsonList('stocks.json').map(addPinyinToStock);
fundListCache = readJsonList('funds.json').map(normalizeFund).filter(isExchangeEtf);
fundListFetchedAt = fundListCache.length ? Date.now() : 0;
console.log('Stock count:', stockListCache.length);
console.log('Local ETF fund count:', fundListCache.length);
scheduleFundRefresh();

router.get('/stocklist', async function (req, res) {
  if (req.query.refreshFunds === '1') {
    try {
      await refreshFundList();
    } catch (e) {
      console.warn('Manual ETF fund refresh failed:', e.message);
    }
  } else {
    scheduleFundRefresh();
  }
  res.json({ success: true, data: getMergedStockList() });
});

module.exports = router;
