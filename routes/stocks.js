const express = require('express');
const router = express.Router();

const fs = require('fs');
const pinyin = require('tiny-pinyin');

let stockListCache = [];

function addPinyinToStock(stock) {
  if (pinyin.isSupported() && stock.name) {
    const fullPinyin = pinyin.convertToPinyin(stock.name, '-', true);
    const abbr = fullPinyin.split('-').map(p => p[0]).join('');
    stock.py = fullPinyin.replace(/-/g, '');
    stock.pinyin = abbr;
  }
  return stock;
}

try {
  const stockData = fs.readFileSync('./stocks.json', 'utf8');
  stockListCache = JSON.parse(stockData).map(addPinyinToStock);
  console.log('Stock count:', stockListCache.length);
} catch (e) {
  console.error('Read stocks.json failed:', e.message);
}

router.get('/stocklist', function (req, res) {
  res.json(stockListCache);
});

module.exports = router;
