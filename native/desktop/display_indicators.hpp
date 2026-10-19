#pragma once
#include "engine.hpp"

namespace displayIndicators {
// Matches the old chart's first-price seed and four-decimal recurrence.
// This is presentation only: strategy/backtest market::macd remains unchanged.
inline market::Macd macd(const std::vector<market::Bar>& bars, int fast, int slow,
                         int signal, std::vector<int>& run) {
  market::period(fast);market::period(slow);market::period(signal);
  market::Macd out;
  out.dif.assign(bars.size(),NAN);out.dea.assign(bars.size(),NAN);out.hist.assign(bars.size(),NAN);
  run.assign(bars.size(),0);
  double shortEma=0,longEma=0,dea=0;int count=0;
  auto rounded=[](double v){return std::round(v*10000.)/10000.;};
  for(size_t i=0;i<bars.size();++i){
    if(!market::valid(bars[i])){count=0;continue;}
    const auto close=bars[i].close;
    if(!count){shortEma=longEma=close;dea=0;}
    else{shortEma=rounded((close-shortEma)*2/(fast+1)+shortEma);
         longEma=rounded((close-longEma)*2/(slow+1)+longEma);}
    out.dif[i]=rounded(shortEma-longEma);
    dea=count?rounded((out.dif[i]-dea)*2/(signal+1)+dea):out.dif[i];
    out.dea[i]=dea;out.hist[i]=rounded((out.dif[i]-dea)*2);run[i]=++count;
  }
  return out;
}
}
