function calcMAFromData(data, periods) {
  periods.forEach(p => {
    const key = 'ma' + p;
    for (let i = 0; i < data.length; i++) {
      if (i < p - 1) { data[i][key] = null; continue; }
      let sum = 0;
      for (let j = i - p + 1; j <= i; j++) sum += data[j].close;
      data[i][key] = +(sum / p).toFixed(2);
    }
  });
}

function calcMACD(data, shortPeriod, longPeriod, signalPeriod) {
  shortPeriod = shortPeriod || 12;
  longPeriod = longPeriod || 26;
  signalPeriod = signalPeriod || 9;
  const emaShort = [];
  const emaLong = [];
  const dif = [];
  const dea = [];
  const bar = [];

  const shortAlpha = 2 / (shortPeriod + 1);
  const longAlpha = 2 / (longPeriod + 1);
  const signalAlpha = 2 / (signalPeriod + 1);

  for (let i = 0; i < data.length; i++) {
    const close = data[i].close;
    if (i === 0) {
      emaShort[i] = close;
      emaLong[i] = close;
    } else {
      emaShort[i] = +((close - emaShort[i - 1]) * shortAlpha + emaShort[i - 1]).toFixed(4);
      emaLong[i] = +((close - emaLong[i - 1]) * longAlpha + emaLong[i - 1]).toFixed(4);
    }
    dif[i] = +((emaShort[i] - emaLong[i]).toFixed(4));
    if (i === 0) {
      dea[i] = dif[i];
    } else {
      dea[i] = +((dif[i] - dea[i - 1]) * signalAlpha + dea[i - 1]).toFixed(4);
    }
    bar[i] = +((dif[i] - dea[i]) * 2).toFixed(4);
    data[i].macd_dif = dif[i];
    data[i].macd_dea = dea[i];
    data[i].macd_bar = bar[i];
  }
}

function calcKDJ(data, period) {
  period = period || 9;
  const lowList = [];
  const highList = [];
  const rsv = [];
  const k = [];
  const d = [];
  const j = [];

  for (let i = 0; i < data.length; i++) {
    lowList.push(data[i].low);
    highList.push(data[i].high);
    if (i >= period - 1) {
      const periodLow = Math.min.apply(null, lowList.slice(i - period + 1, i + 1));
      const periodHigh = Math.max.apply(null, highList.slice(i - period + 1, i + 1));
      const close = data[i].close;
      rsv[i] = periodHigh === periodLow ? 50 : +(((close - periodLow) / (periodHigh - periodLow)) * 100).toFixed(2);
    } else {
      rsv[i] = 50;
    }
    if (i === 0) {
      k[i] = 50;
      d[i] = 50;
    } else {
      k[i] = +((rsv[i] * (1 / 3)) + (k[i - 1] * (2 / 3))).toFixed(2);
      d[i] = +((k[i] * (1 / 3)) + (d[i - 1] * (2 / 3))).toFixed(2);
    }
    j[i] = +((3 * k[i] - 2 * d[i]).toFixed(2));
    data[i].kdj_k = k[i];
    data[i].kdj_d = d[i];
    data[i].kdj_j = j[i];
  }
}

function calcRSI(data, period) {
  period = period || 14;
  const gains = [];
  const losses = [];
  const avgGains = [];
  const avgLosses = [];
  const rsi = [];

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      gains[i] = 0;
      losses[i] = 0;
    } else {
      const change = data[i].close - data[i - 1].close;
      gains[i] = Math.max(change, 0);
      losses[i] = Math.max(-change, 0);
    }
    if (i >= period - 1) {
      let sumGains = 0;
      let sumLosses = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sumGains += gains[j];
        sumLosses += losses[j];
      }
      avgGains[i] = sumGains / period;
      avgLosses[i] = sumLosses / period;
    } else {
      avgGains[i] = null;
      avgLosses[i] = null;
    }
    if (avgLosses[i] === 0) {
      rsi[i] = 100;
    } else if (avgGains[i] === null) {
      rsi[i] = null;
    } else {
      rsi[i] = +((avgGains[i] / (avgGains[i] + avgLosses[i])) * 100).toFixed(2);
    }
    data[i].rsi = rsi[i];
  }
}

function calcCCI(data, period) {
  period = period || 14;
  const typicalPrices = [];
  const sma = [];
  const meanDeviation = [];
  const cci = [];

  for (let i = 0; i < data.length; i++) {
    typicalPrices[i] = +(((data[i].high + data[i].low + data[i].close) / 3)).toFixed(4);
    if (i >= period - 1) {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        sum += typicalPrices[j];
      }
      sma[i] = +((sum / period)).toFixed(4);
      let devSum = 0;
      for (let j = i - period + 1; j <= i; j++) {
        devSum += Math.abs(typicalPrices[j] - sma[i]);
      }
      meanDeviation[i] = +((devSum / period)).toFixed(4);
    } else {
      sma[i] = null;
      meanDeviation[i] = null;
    }
    if (meanDeviation[i] === 0) {
      cci[i] = 0;
    } else if (sma[i] === null) {
      cci[i] = null;
    } else {
      cci[i] = +(((typicalPrices[i] - sma[i]) / (0.015 * meanDeviation[i]))).toFixed(2);
    }
    data[i].cci = cci[i];
  }
}

function calcOBV(data) {
  let obv = 0;
  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      obv = data[i].volume || 0;
    } else {
      if (data[i].close > data[i - 1].close) {
        obv += data[i].volume || 0;
      } else if (data[i].close < data[i - 1].close) {
        obv -= data[i].volume || 0;
      }
    }
    data[i].obv = obv;
  }
}

function calcATR(data, period) {
  period = period || 14;
  const tr = [];
  const atr = [];

  for (let i = 0; i < data.length; i++) {
    if (i === 0) {
      tr[i] = data[i].high - data[i].low;
    } else {
      const hl = data[i].high - data[i].low;
      const hc = Math.abs(data[i].high - data[i - 1].close);
      const lc = Math.abs(data[i].low - data[i - 1].close);
      tr[i] = Math.max(hl, hc, lc);
    }
    if (i >= period - 1) {
      if (i === period - 1) {
        let sum = 0;
        for (let j = 0; j <= i; j++) sum += tr[j];
        atr[i] = +((sum / period)).toFixed(4);
      } else {
        atr[i] = +(((atr[i - 1] * (period - 1)) + tr[i]) / period).toFixed(4);
      }
    } else {
      atr[i] = null;
    }
    data[i].atr = atr[i];
  }
}

function calcVWAP(data) {
  let cumulativeVolume = 0;
  let cumulativeAmount = 0;
  for (let i = 0; i < data.length; i++) {
    const volume = data[i].volume || 0;
    const close = data[i].close || 0;
    const amount = data[i].amount || close * volume;
    cumulativeVolume += volume;
    cumulativeAmount += amount;
    data[i].vwap = cumulativeVolume > 0 ? +(cumulativeAmount / cumulativeVolume).toFixed(4) : null;
  }
}

window.Indicators = {
  calcMAFromData,
  calcMACD,
  calcKDJ,
  calcRSI,
  calcCCI,
  calcOBV,
  calcATR,
  calcVWAP
};
