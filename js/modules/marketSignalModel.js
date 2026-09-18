(function(root, factory) {
  const api = factory(root ? root.AuctionRules : require('./auctionRules'));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.MarketSignalModel = api;
})(typeof window !== 'undefined' ? window : null, function(auctionRules) {
  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function round(value, digits) {
    if (!Number.isFinite(value)) return null;
    return Number(value.toFixed(digits == null ? 2 : digits));
  }

  function average(values) {
    const valid = values.map(finite).filter(function(value) { return value !== null; });
    return valid.length ? valid.reduce(function(sum, value) { return sum + value; }, 0) / valid.length : null;
  }

  function validDailyRows(rows) {
    return (Array.isArray(rows) ? rows : []).filter(function(row) {
      return row && finite(row.close) > 0;
    }).slice().sort(function(left, right) {
      return String(left.date || '').localeCompare(String(right.date || ''));
    });
  }

  function movingAverage(rows, period) {
    if (rows.length < period) return null;
    return round(average(rows.slice(-period).map(function(row) { return row.close; })), 2);
  }

  function analyzeDaily(input) {
    const rows = validDailyRows(input);
    if (!rows.length) return { available: false };
    const latest = rows[rows.length - 1];
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    const close = finite(latest.close);
    const previousClose = finite(previous && previous.close);
    const open = finite(latest.open);
    const high = finite(latest.high);
    const low = finite(latest.low);
    const priorFiveVolumes = rows.slice(Math.max(0, rows.length - 6), -1).map(function(row) {
      return row.volume;
    });
    const priorVolumeAverage = average(priorFiveVolumes);
    const currentVolume = finite(latest.volume);
    const ma5 = movingAverage(rows, 5);
    const ma10 = movingAverage(rows, 10);
    const ma20 = movingAverage(rows, 20);
    let trend = '均线交错';
    if (close > ma5 && ma5 > ma10 && ma10 > ma20) trend = '多头排列';
    else if (close < ma5 && ma5 < ma10 && ma10 < ma20) trend = '空头排列';

    return {
      available: true,
      date: String(latest.date || ''),
      close,
      previousClose,
      changeAmount: previousClose > 0 ? round(close - previousClose, 2) : null,
      changePercent: previousClose > 0 ? round((close - previousClose) / previousClose * 100, 2) : null,
      gapPercent: previousClose > 0 && open > 0 ? round((open - previousClose) / previousClose * 100, 2) : null,
      amplitudePercent: previousClose > 0 && high > 0 && low > 0
        ? round((high - low) / previousClose * 100, 2) : null,
      volumeRatio5: priorVolumeAverage > 0 && currentVolume !== null
        ? round(currentVolume / priorVolumeAverage, 2) : null,
      ma5,
      ma10,
      ma20,
      trend
    };
  }

  function calculateNineTurn(input) {
    const rows = validDailyRows(input);
    if (rows.length < 5) {
      return { available: false, direction: null, count: 0, stage: 0, completed: false, label: '样本不足' };
    }
    const lastIndex = rows.length - 1;
    const lastDiff = finite(rows[lastIndex].close) - finite(rows[lastIndex - 4].close);
    const direction = lastDiff > 0 ? 'up' : lastDiff < 0 ? 'down' : null;
    let count = 0;
    if (direction) {
      for (let index = lastIndex; index >= 4; index -= 1) {
        const diff = finite(rows[index].close) - finite(rows[index - 4].close);
        if ((direction === 'up' && diff > 0) || (direction === 'down' && diff < 0)) count += 1;
        else break;
      }
    }
    const stage = Math.min(count, 9);
    const completed = count >= 9;
    const label = !direction ? '无连续序列' : direction === 'up'
      ? (completed ? '高9观察' : '上行' + stage)
      : (completed ? '低9观察' : '下行' + stage);
    return {
      available: true,
      direction,
      count,
      stage,
      completed,
      label,
      rule: '简化九转：当日收盘价与4个交易日前收盘价同向比较，连续计数至9。'
    };
  }

  function timeLabel(row) {
    const match = String(row && row.time || '').match(/(\d{2}:\d{2})/);
    return match ? match[1] : '';
  }

  function validMinuteRows(input) {
    return (Array.isArray(input) ? input : []).filter(function(row) {
      return row && finite(row.price) > 0 && timeLabel(row);
    }).slice().sort(function(left, right) {
      return String(left.time || '').localeCompare(String(right.time || ''));
    });
  }

  function findIntradayBreakout(input) {
    const minutes = validMinuteRows(input);
    for (let end = 18; end <= minutes.length; end += 1) {
      const baseline = minutes.slice(end - 18, end - 3);
      const recent = minutes.slice(end - 3, end);
      const baselineHigh = Math.max.apply(null, baseline.map(function(row) { return finite(row.price); }));
      const baselineVolume = average(baseline.slice(-10).map(function(row) { return row.volume; }));
      const recentVolume = average(recent.map(function(row) { return row.volume; }));
      const trigger = recent[recent.length - 1];
      if (finite(trigger.price) > baselineHigh && baselineVolume > 0 && recentVolume >= baselineVolume * 1.8) {
        return {
          active: true,
          time: timeLabel(trigger),
          price: finite(trigger.price),
          baselineHigh: round(baselineHigh, 2),
          volumeRatio: round(recentVolume / baselineVolume, 2)
        };
      }
    }
    return { active: false };
  }

  function buildIntradayMarkers(input) {
    const minutes = validMinuteRows(input);
    if (!minutes.length) return [];
    const markers = [];
    const open = minutes.find(function(row) { return timeLabel(row) === '09:30'; });
    const closing = minutes.find(function(row) {
      const label = timeLabel(row);
      return label >= '14:57' && label <= '15:00';
    });
    const breakout = findIntradayBreakout(minutes);
    if (open) markers.push({
      value: '开', label: '连续竞价起点', time: '09:30', price: finite(open.price),
      detail: '9:30 连续竞价起点，只标示时间位置。', triggerUsesFutureData: false
    });
    if (breakout.active) markers.push({
      value: '突', label: '本地盘中量价突破', time: breakout.time, price: breakout.price,
      detail: '价格突破此前15分钟高点，近3分钟均量为基准的' + breakout.volumeRatio + '倍。',
      triggerUsesFutureData: false
    });
    if (closing) markers.push({
      value: '尾', label: '尾盘集合竞价起点', time: timeLabel(closing), price: finite(closing.price),
      detail: '14:57 尾盘集合竞价观察区间起点。', triggerUsesFutureData: false
    });
    return markers;
  }

  function analyzeAuction(dailyInput, minuteInput, meta, localInput, localMeta) {
    const dailyRows = validDailyRows(dailyInput);
    const rawMinuteRows = (Array.isArray(minuteInput) ? minuteInput : []).filter(function(row) {
      return row && finite(row.price) > 0;
    }).slice().sort(function(left, right) {
      return String(left.time || '').localeCompare(String(right.time || ''));
    });
    const source = meta || {};
    const localSource = localMeta || {};
    const latestDaily = dailyRows[dailyRows.length - 1] || null;
    const previousDaily = dailyRows.length > 1 ? dailyRows[dailyRows.length - 2] : null;
    const dailyTradingDate = String(latestDaily && latestDaily.date || '');
    const minuteTradingDate = String(source.tradingDate ||
      (rawMinuteRows[0] && rawMinuteRows[0].time || '').slice(0, 10));
    const expectedTradingDate = dailyTradingDate || minuteTradingDate;
    const minuteDateMatched = !dailyTradingDate || !minuteTradingDate || dailyTradingDate === minuteTradingDate;
    const minuteRows = rawMinuteRows.filter(function(row) {
      return minuteDateMatched && (!expectedTradingDate || String(row.time || '').startsWith(expectedTradingDate));
    });
    const localAuctionRows = (Array.isArray(localInput) ? localInput : []).filter(function(row) {
      const label = timeLabel(row);
      return row && finite(row.price) > 0 && label >= '09:15' && label <= '09:25' &&
        (!expectedTradingDate || String(row.time || '').startsWith(expectedTradingDate));
    }).slice().sort(function(left, right) {
      return String(left.time || '').localeCompare(String(right.time || ''));
    });
    const previousClose = (minuteDateMatched ? finite(source.previousClose) : null) ||
      finite(previousDaily && previousDaily.close);
    const openingRow = minuteRows.find(function(row) { return timeLabel(row) === '09:30'; }) || minuteRows[0] || null;
    const openPrice = finite(latestDaily && latestDaily.open) || finite(openingRow && openingRow.price);
    const closingRows = minuteRows.filter(function(row) {
      const label = timeLabel(row);
      return label >= '14:57' && label <= '15:00';
    });
    const closingStart = closingRows[0] || null;
    const closingEnd = closingRows[closingRows.length - 1] || null;
    const closingComplete = ['14:57','14:58','14:59','15:00'].every(function(label) {
      return closingRows.some(function(row) { return timeLabel(row) === label; });
    });
    const totalVolume = minuteRows.reduce(function(sum, row) {
      const volume = finite(row.volume);
      return sum + (volume !== null && volume >= 0 ? volume : 0);
    }, 0);
    const closingVolume = closingRows.reduce(function(sum, row) {
      const volume = finite(row.volume);
      return sum + (volume !== null && volume >= 0 ? volume : 0);
    }, 0);
    const closingStartPrice = finite(closingStart && closingStart.price);
    const closingEndPrice = finite(closingEnd && closingEnd.price);
    const gapPercent = previousClose > 0 && openPrice > 0
      ? round((openPrice - previousClose) / previousClose * 100, 2) : null;
    const closingReturn = closingStartPrice > 0 && closingEndPrice > 0
      ? round((closingEndPrice - closingStartPrice) / closingStartPrice * 100, 2) : null;
    const closingShare = totalVolume > 0 ? round(closingVolume / totalVolume * 100, 2) : null;
    const localFirstPrice = finite(localAuctionRows[0] && localAuctionRows[0].price);
    const localLastPrice = finite(localAuctionRows[localAuctionRows.length - 1] && localAuctionRows[localAuctionRows.length - 1].price);
    const localObservedChange = localFirstPrice > 0 && localLastPrice > 0
      ? round((localLastPrice - localFirstPrice) / localFirstPrice * 100, 2) : null;
    const localObservedVolume = localAuctionRows.reduce(function(sum, row) {
      const volume = finite(row.volume);
      return sum + (volume !== null && volume >= 0 ? volume : 0);
    }, 0);
    const indicativeRow = localAuctionRows.slice().reverse().find(function(row) {
      return finite(row.auctionReferencePrice) !== null || finite(row.auctionMatchedVolume) !== null ||
        finite(row.auctionUnmatchedBuyVolume) !== null || finite(row.auctionUnmatchedSellVolume) !== null;
    }) || null;
    const indicativePrice = finite(indicativeRow && indicativeRow.auctionReferencePrice);
    const indicativeMatchedVolume = finite(indicativeRow && indicativeRow.auctionMatchedVolume);
    const indicativeUnmatchedBuyVolume = finite(indicativeRow && indicativeRow.auctionUnmatchedBuyVolume);
    const indicativeUnmatchedSellVolume = finite(indicativeRow && indicativeRow.auctionUnmatchedSellVolume);
    const available = dailyRows.length > 0 || minuteRows.length > 0;
    let openingInterpretation = '缺少可用开盘数据';
    if (gapPercent !== null) {
      openingInterpretation = gapPercent >= 2 ? '明显高开，重点观察能否守住开盘价'
        : gapPercent <= -2 ? '明显低开，重点观察是否快速收复昨收'
          : '平开附近，后续走势更依赖连续竞价量价';
    }
    let closingInterpretation = '14:57—15:00分钟数据不完整，不能判定尾盘强弱或竞价形态';
    if (closingComplete && closingReturn !== null) {
      closingInterpretation = closingReturn >= 0.8 && closingShare >= 3
        ? '尾盘量价偏强，但需次日确认是否延续'
        : closingReturn <= -0.8 && closingShare >= 3
          ? '尾盘抛压偏强，需关注次日承接'
          : '尾盘波动相对温和，未见明确单边信号';
    }
    const processInput = {rows:localInput,meta:localSource,date:expectedTradingDate,
      asOf:localSource.fetchedAt,history:localSource.auctionHistory};
    const openingProcess=auctionRules ? auctionRules.analyze({...processInput,phase:'opening',baseline:previousClose,
      baselineAvailableAt:localSource.previousCloseAvailableAt}) : null;
    const closingProcess=auctionRules ? auctionRules.analyze({...processInput,phase:'closing',
      baseline:localSource.closingBaselineVerified===true?finite(localSource.closingBaselinePrice):null,
      baselineEventTime:localSource.closingBaselineEventTime,
      baselineAvailableAt:localSource.closingBaselineAvailableAt}) : null;

    return {
      available,
      tradingDate: expectedTradingDate,
      minuteDateMatched,
      source: String(source.dataSource || 'public-minute'),
      opening: {
        dataLevel: openingProcess ? openingProcess.dataLevel : 'D0',
        patternStatus: openingProcess ? openingProcess.patternStatus : 'insufficient-data',
        process: openingProcess,
        previousClose: previousClose || null,
        openPrice: openPrice || null,
        gapPercent,
        firstMinuteVolume: finite(openingRow && openingRow.volume),
        volumeIsAuctionExact: false,
        dataStatus: localAuctionRows.length > 0
          ? 'local-public-auction-observed'
          : openingRow ? 'public-minute-proxy' : 'unavailable',
        localObserved: localAuctionRows.length > 0,
        localSampleCount: localAuctionRows.length,
        localObservedFrom: localAuctionRows.length ? timeLabel(localAuctionRows[0]) : null,
        localObservedTo: localAuctionRows.length ? timeLabel(localAuctionRows[localAuctionRows.length - 1]) : null,
        localObservedStartPrice: localFirstPrice,
        localObservedEndPrice: localLastPrice,
        localObservedChangePercent: localObservedChange,
        localObservedVolume: localObservedVolume || null,
        localSource: String(localSource.dataSource || 'local-30s-unavailable'),
        indicativePrice,
        indicativeMatchedVolume,
        indicativeUnmatchedBuyVolume,
        indicativeUnmatchedSellVolume,
        interpretation: openingInterpretation
      },
      closing: {
        dataLevel: closingProcess ? closingProcess.dataLevel : 'D0',
        patternStatus: closingProcess ? closingProcess.patternStatus : 'insufficient-data',
        process: closingProcess,
        coverageComplete: closingComplete,
        dataStatus: closingRows.length > 0 ? 'public-minute-interval' : 'unavailable',
        sampleCount: closingRows.length,
        from: closingStart ? timeLabel(closingStart) : null,
        to: closingEnd ? timeLabel(closingEnd) : null,
        startPrice: closingStartPrice,
        closePrice: closingEndPrice,
        returnPercent: closingReturn,
        volume: closingVolume || null,
        volumeSharePercent: closingShare,
        interpretation: closingInterpretation
      },
      limitation: '当前为普通价量参考，缺少已核验的竞价过程，不能判定完整竞价形态。' + (localAuctionRows.length
        ? '竞价时段数据来自程序运行期间保存的公开报价快照，不是交易所授权历史回放；09:30首分钟量仍不等同于9:25集合竞价成交量。'
        : '当天未在9:15—9:25保存公开报价快照，事后普通分钟接口只能以09:30首分钟作参考，不能补回虚拟匹配量、未匹配量或逐笔委托。')
    };
  }

  function detectLocalSignals(dailyInput, minuteInput) {
    const rows = validDailyRows(dailyInput);
    const latest = rows[rows.length - 1] || null;
    const previousRows = rows.slice(0, -1);
    const previousTwenty = previousRows.slice(-20);
    const previousFiveVolume = average(previousRows.slice(-5).map(function(row) { return row.volume; }));
    const latestClose = finite(latest && latest.close);
    const latestVolume = finite(latest && latest.volume);
    const priorHigh = previousTwenty.length ? Math.max.apply(null, previousTwenty.map(function(row) {
      return finite(row.high) || finite(row.close) || 0;
    })) : null;
    const breakoutActive = previousTwenty.length >= 10 && latestClose > priorHigh &&
      previousFiveVolume > 0 && latestVolume >= previousFiveVolume * 1.2;

    const recentTen = rows.slice(-10);
    const ma20 = movingAverage(rows, 20);
    const tenHigh = recentTen.length ? Math.max.apply(null, recentTen.map(function(row) {
      return finite(row.high) || finite(row.close) || 0;
    })) : null;
    const tenLow = recentTen.length ? Math.min.apply(null, recentTen.map(function(row) {
      return finite(row.low) || finite(row.close) || Infinity;
    })) : null;
    const recentThreeVolume = average(rows.slice(-3).map(function(row) { return row.volume; }));
    const earlierSevenVolume = average(rows.slice(-10, -3).map(function(row) { return row.volume; }));
    const rangePercent = tenLow > 0 ? (tenHigh - tenLow) / tenLow * 100 : null;
    const accumulationActive = recentTen.length === 10 && ma20 > 0 && latestClose >= ma20 &&
      rangePercent <= 10 && earlierSevenVolume > 0 && recentThreeVolume >= earlierSevenVolume * 1.1;

    const intradayBreakout = findIntradayBreakout(minuteInput);

    return [{
      key: 'accumulation',
      label: '积·蓄势观察',
      active: accumulationActive,
      reason: accumulationActive
        ? '近10日振幅收敛、收盘不低于MA20且近3日均量较此前7日提升。'
        : '尚未同时满足整理、MA20与量能回升条件。',
      rule: '本地规则：近10日区间≤10%，收盘≥MA20，近3日均量≥此前7日均量1.1倍。',
      proprietaryEquivalent: false
    }, {
      key: 'breakout',
      label: '突·放量突破观察',
      active: breakoutActive,
      reason: breakoutActive
        ? '收盘突破近20日高点，且成交量达到此前5日均量的1.2倍。'
        : '尚未同时满足20日价格突破与放量条件。',
      rule: '本地规则：收盘>近20日高点，成交量≥此前5日均量1.2倍。',
      proprietaryEquivalent: false
    }, {
      key: 'intraday-breakout',
      label: '盘中突·量价观察',
      active: intradayBreakout.active,
      triggerTime: intradayBreakout.time || null,
      triggerPrice: intradayBreakout.price || null,
      triggerUsesFutureData: false,
      reason: intradayBreakout.active
        ? '最近价格突破此前15分钟高点，且近3分钟均量明显放大。'
        : '当前分钟数据未触发本地盘中突破阈值。',
      rule: '本地规则：最近价>此前15分钟高点，近3分钟均量≥此前10分钟均量1.8倍。',
      proprietaryEquivalent: false
    }];
  }

  return {
    analyzeDaily,
    calculateNineTurn,
    analyzeAuction,
    detectLocalSignals,
    buildIntradayMarkers
  };
});
