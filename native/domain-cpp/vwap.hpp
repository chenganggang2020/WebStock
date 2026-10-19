#pragma once
#include <vector>
#include <string>
#include <cstdint>
#include <limits>
namespace vwap {
inline double missing(){return std::numeric_limits<double>::quiet_NaN();}
struct Point {std::int64_t time=-1;std::string session;double high=missing(),low=missing(),close=missing(),volume=missing(),amount=missing();bool valid=true,closed=true,axisGap=false;};
struct Params {std::string mode="legacy-close-approx",anchor="session",period="intraday",anchorId,quantities="incremental",volumeUnit="unknown",priceBasis="unknown";double volumeToShares=missing(),amountToCny=missing();bool coversFromOpen=false;};
struct Series {std::vector<double> values;std::vector<std::string> reasons;std::vector<bool> provisional,breakBefore;std::string label,explanation,coverage;bool approximate=true;};
Series calculate(const std::vector<Point>&,const Params&);
std::string explain(const Series&,std::size_t index);
}
