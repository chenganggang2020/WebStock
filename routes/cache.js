const minuteCache = new Map();
const klineCache = new Map();

function latestCacheTimestamp() {
  let latest = 0;
  [minuteCache, klineCache].forEach(function(cache) {
    cache.forEach(function(entry) {
      const timestamp = Number(entry && entry.ts) || 0;
      if (timestamp > latest) latest = timestamp;
    });
  });
  return latest;
}

module.exports = {
  minuteCache,
  klineCache,
  latestCacheTimestamp
};
