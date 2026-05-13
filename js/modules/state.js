let allStocks = [];
let filteredStocks = [];
let searchResults = [];
let currentStock = null;
let currentRawData = [];
let currentIndicator = 'ma';
let currentPeriod = 'day';
let currentView = 'realtime';
let klineChart = null;
let timeChart = null;
let volumeChart = null;
let maPeriods = [5, 10, 15, 30];
let currentPage = 0;
const PAGE_SIZE = 200;
let currentQuote = null;
let currentMainView = 'dashboard';
let watchlist = [];
let recentStocks = [];
let trades = [];
let positions = [];
let portfolioSummary = null;
let portfolioAllocation = [];
let klineSnapshots = {};
let screenerReviewSummary = [];

const State = {
  get allStocks() { return allStocks; },
  set allStocks(val) { allStocks = val; },
  get filteredStocks() { return filteredStocks; },
  set filteredStocks(val) { filteredStocks = val; },
  get searchResults() { return searchResults; },
  set searchResults(val) { searchResults = val; },
  get currentStock() { return currentStock; },
  set currentStock(val) { currentStock = val; },
  get currentRawData() { return currentRawData; },
  set currentRawData(val) { currentRawData = val; },
  get currentIndicator() { return currentIndicator; },
  set currentIndicator(val) { currentIndicator = val; },
  get currentPeriod() { return currentPeriod; },
  set currentPeriod(val) { currentPeriod = val; },
  get currentView() { return currentView; },
  set currentView(val) { currentView = val; },
  get klineChart() { return klineChart; },
  set klineChart(val) { klineChart = val; },
  get timeChart() { return timeChart; },
  set timeChart(val) { timeChart = val; },
  get volumeChart() { return volumeChart; },
  set volumeChart(val) { volumeChart = val; },
  get maPeriods() { return maPeriods; },
  set maPeriods(val) { maPeriods = val; },
  get currentPage() { return currentPage; },
  set currentPage(val) { currentPage = val; },
  PAGE_SIZE,
  get currentQuote() { return currentQuote; },
  set currentQuote(val) { currentQuote = val; },
  get currentMainView() { return currentMainView; },
  set currentMainView(val) { currentMainView = val; },
  get watchlist() { return watchlist; },
  set watchlist(val) { watchlist = val; },
  get recentStocks() { return recentStocks; },
  set recentStocks(val) { recentStocks = val; },
  get trades() { return trades; },
  set trades(val) { trades = val; },
  get positions() { return positions; },
  set positions(val) { positions = val; },
  get portfolioSummary() { return portfolioSummary; },
  set portfolioSummary(val) { portfolioSummary = val; },
  get portfolioAllocation() { return portfolioAllocation; },
  set portfolioAllocation(val) { portfolioAllocation = val; },
  get klineSnapshots() { return klineSnapshots; },
  set klineSnapshots(val) { klineSnapshots = val || {}; },
  get screenerReviewSummary() { return screenerReviewSummary; },
  set screenerReviewSummary(val) { screenerReviewSummary = Array.isArray(val) ? val : []; }
};

window.State = State;
