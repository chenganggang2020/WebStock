#pragma once
#include <map>
#include <string>
#include <vector>
#include <variant>
#include <stdexcept>
#include <cmath>
#include <algorithm>
#include <limits>
namespace scenario {
struct Value {
    using Array=std::vector<Value>;
    using Object=std::map<std::string,Value>;
    std::variant<std::nullptr_t,bool,double,std::string,Array,Object> data;
    Value():data(nullptr){} Value(std::nullptr_t):data(nullptr){} Value(bool v):data(v){}
    Value(double v):data(v){} Value(int v):data(double(v)){} Value(std::size_t v):data(double(v)){}
    Value(const char* v):data(std::string(v)){} Value(std::string v):data(std::move(v)){}
    Value(Array v):data(std::move(v)){} Value(Object v):data(std::move(v)){}
};
using Array=Value::Array;
using Object=Value::Object;
inline const std::vector<std::string> modules={"target","recovery","cashBuffer","stagedAverage","breakEven","risk","drawdown","rebalance","stress","stopExposure","ledger","cost","positionSize","riskReward","expectancy","readiness","lossPath","lossRun","pnlDistribution","equityPath"};
inline const std::vector<std::string> titles={"目标路径","回撤修复时间","现金缓冲垫","分批建仓均价","保本退出价","风险画像","资产峰谷","再平衡沙盘","压力测试","止损风险暴露","交易账本分析","成本侵蚀","风险预算仓位","盈亏比门槛","期望值","方法验证","连续亏损路径","IID连亏实验","盈亏分布","样本权益路径"};
namespace detail {
inline constexpr double eps=std::numeric_limits<double>::epsilon();
inline void need(bool ok,const std::string& why){if(!ok)throw std::invalid_argument(why);}
inline const Object& object(const Value& v){auto p=std::get_if<Object>(&v.data);need(p,"必须提供对象");return *p;}
inline const Value& get(const Object& o,const std::string& key){static const Value missing;auto it=o.find(key);return it==o.end()?missing:it->second;}
inline bool valid(const Value& v){auto p=std::get_if<double>(&v.data);return p&&std::isfinite(*p)&&std::abs(*p)<=1e15;}
inline double number(const Value& v,const std::string& key){need(valid(v),key+" 必须是有限数字，不能缺失或以文字代替");return std::get<double>(v.data);}
inline double n(const Object& x,const std::string& k){return number(get(x,k),k);}
inline double nonnegative(const Object& x,const std::string& k){double v=n(x,k);need(v>=0,k+" 不能小于0");return v;}
inline double positive(const Object& x,const std::string& k){double v=n(x,k);need(v>0,k+" 必须大于0");return v;}
inline double optional(const Object& x,const std::string& k,double fallback){return x.count(k)?n(x,k):fallback;}
inline int integer(const Object& x,const std::string& k,int lo,int hi){double v=n(x,k);need(v==std::floor(v)&&v>=lo&&v<=hi,k+" 整数超范围");return int(v);}
inline double lot(const Object& x){double v=optional(x,"lotSize",100);need(v>0&&v==std::floor(v),"每手数量必须为正整数");return v;}
inline const Array& array(const Object& x,const std::string& key,std::size_t lo=0,std::size_t hi=10000){auto p=std::get_if<Array>(&get(x,key).data);need(p,key+" 必须提供数组");need(p->size()>=lo&&p->size()<=hi,key+" 数量超范围");return *p;}
inline std::string text(const Object& x,const std::string& key){auto p=std::get_if<std::string>(&get(x,key).data);return p?*p:"";}
inline double r(double v,int digits=2){need(std::isfinite(v),"计算超出有限数值范围");double factor=std::pow(10,digits),scaled=(v+eps)*factor;need(std::isfinite(scaled),"计算超出舍入范围");return std::floor(scaled+.5)/factor;}
inline void finite(const Value& v){if(auto p=std::get_if<double>(&v.data))need(std::isfinite(*p),"结果数值溢出");else if(auto a=std::get_if<Array>(&v.data)){for(const auto& i:*a)finite(i);}else if(auto o=std::get_if<Object>(&v.data)){for(const auto& p:*o)finite(p.second);}}
inline int months(const Object& x){double years=positive(x,"years");need(years<=50,"期限不能超过50年");return std::max(1,int(std::floor(years*12+.5)));}
inline double future(double capital,double contribution,int count,double annual){double monthly=std::pow(1+annual,1.0/12)-1,assets=capital;for(int i=0;i<count;++i)assets=assets*(1+monthly)+contribution;return assets;}
inline Value target(const Object& x){
 double capital=nonnegative(x,"initialCapital"),contribution=nonnegative(x,"monthlyContribution"),goal=positive(x,"targetCapital");int count=months(x);
 double lower=-.999999,upper=1;need(goal>=future(capital,contribution,count,lower),"目标低于当前投入路径可求解范围");
 while(future(capital,contribution,count,upper)<goal&&upper<1024)upper=upper*2+1;
 need(future(capital,contribution,count,upper)>=goal,"目标资产超出当前求解范围");
 for(int i=0;i<120;++i){double mid=(lower+upper)/2;if(future(capital,contribution,count,mid)<goal)lower=mid;else upper=mid;}
 double annual=r((lower+upper)/2*100,6),monthly=std::pow(1+annual/100,1.0/12)-1,assets=capital;
 Array points{Object{{"month",0},{"assets",r(assets)},{"contributions",r(capital)},{"investmentGain",0}}};
 for(int i=1;i<=count;++i){assets=assets*(1+monthly)+contribution;double added=capital+contribution*i;points.emplace_back(Object{{"month",i},{"assets",r(assets)},{"contributions",r(added)},{"investmentGain",r(assets-added)}});}
 double added=capital+contribution*count;return Object{{"months",count},{"annualRatePercent",annual},{"monthlyRatePercent",r(monthly*100,6)},{"totalContributions",r(added)},{"finalAssets",r(assets)},{"investmentGain",r(assets-added)},{"points",points}};
}
inline Value recovery(const Object& x){
 double d=nonnegative(x,"drawdownPercent"),annual=n(x,"annualRatePercent");need(d<100&&annual>-100,"回撤须小于100%，年率须大于-100%");double multiplier=1/(1-d/100);
 Object result{{"reachable",d==0||annual>0},{"exactMonths",d==0?Value(0):Value()},{"wholeMonths",d==0?Value(0):Value()},{"requiredMultiplier",r(multiplier,6)},{"assumption","constant-effective-annual-rate"}};
 if(d==0||annual<=0)return result;double monthly=std::pow(1+annual/100,1.0/12)-1;need(monthly>0,"年率小于可计算精度");double exact=std::log(multiplier)/std::log(1+monthly);
 result["exactMonths"]=r(exact,6);result["wholeMonths"]=std::ceil(exact-eps);result["monthlyRatePercent"]=r(monthly*100,6);return result;
}
inline Value cashBuffer(const Object& x){double cash=nonnegative(x,"cash"),expense=positive(x,"monthlyEssential"),m=nonnegative(x,"reserveMonths");need(m<=120,"储备月数不能超过120");double reserve=expense*m,gap=cash-reserve;return Object{{"coverageMonths",r(cash/expense)},{"requiredReserve",r(reserve)},{"reserveGap",r(gap)},{"shortfall",r(std::max(0.0,-gap))},{"deployableCash",r(std::max(0.0,gap))},{"assumption","user-confirmed-cash-and-essential-spending"}};}
inline Value stagedAverage(const Object& x){
 double cash=positive(x,"cash"),l=lot(x);const auto& prices=array(x,"prices",2,10);const auto& weights=array(x,"weights",2,10);need(prices.size()==weights.size(),"价格与权重数量必须相同");double sum=0;
 for(std::size_t i=0;i<prices.size();++i){double p=number(prices[i],"价格"),w=number(weights[i],"权重");need(p>0&&w>0,"价格与权重必须大于0");sum+=w;}need(std::abs(sum-100)<=1e-6,"权重之和必须是100%");Array stages;double quantity=0,spent=0;
 for(std::size_t i=0;i<prices.size();++i){double p=std::get<double>(prices[i].data),w=std::get<double>(weights[i].data),allocation=cash*w/100,q=std::floor(allocation/p/l)*l,s=q*p;need(std::isfinite(q)&&q<=9e15,"数量超出精确整数范围");stages.emplace_back(Object{{"index",i+1},{"price",r(p,4)},{"weightPercent",r(w,4)},{"allocatedCash",r(allocation)},{"quantity",q},{"spent",r(s)},{"unspentAllocation",r(allocation-s)}});quantity+=q;spent+=r(s);}
 return Object{{"stages",stages},{"totalQuantity",quantity},{"totalSpent",r(spent)},{"averagePrice",quantity>0?Value(r(spent/quantity,6)):Value()},{"remainingCash",r(cash-spent)},{"lotSize",l}};
}
inline Value breakEven(const Object& x){double cost=positive(x,"costBasis"),q=positive(x,"quantity"),fixed=nonnegative(x,"fixedExitCost"),rate=nonnegative(x,"exitRatePercent");need(rate<100,"退出费率必须小于100%");double price=(cost+fixed)/(q*(1-rate/100)),unit=cost/q;return Object{{"breakEvenPrice",r(price,6)},{"costBasisPerShare",r(unit,6)},{"requiredRisePercent",r((price-unit)/unit*100,6)},{"exitRatePercent",r(rate,6)}};}
inline double maybe(const Object& x,const std::string& k){const auto& v=get(x,k);return valid(v)?std::get<double>(v.data):std::numeric_limits<double>::quiet_NaN();}
inline double value(const Object& p){double v=maybe(p,"marketValue");if(std::isfinite(v)&&v>=0)return v;v=maybe(p,"costValue");need(std::isfinite(v)&&v>=0,"持仓缺少有效市值与成本值，不能按0处理");return v;}
inline Value risk(const Object& x){
 const auto& ps=array(x,"positions");double cash=nonnegative(x,"cashBalance"),equity=0;std::vector<Object> weighted;
 for(const auto& pv:ps){const auto& p=object(pv);double v=value(p);if(v<=0)continue;Object c=p;c["value"]=v;c["valueSource"]=std::isfinite(maybe(p,"marketValue"))&&maybe(p,"marketValue")>=0?"marketValue":"costValue-fallback";weighted.push_back(c);equity+=v;}
 double total=equity+cash,hhi=0,top3=0;for(auto& p:weighted){double v=n(p,"value"),w=total>0?v/total*100:0,ew=equity>0?v/equity*100:0;p["weightPercent"]=w;p["equityWeightPercent"]=ew;hhi+=ew*ew;}
 std::stable_sort(weighted.begin(),weighted.end(),[](const Object& a,const Object& b){return n(a,"weightPercent")>n(b,"weightPercent");});double top1=weighted.empty()?0:n(weighted.front(),"weightPercent");for(std::size_t i=0;i<std::min(std::size_t(3),weighted.size());++i)top3+=n(weighted[i],"weightPercent");
 std::string level=equity==0?"unavailable":top1>35||hhi>2500?"high":top1>20||hhi>1500?"medium":"balanced";Array rows;for(auto& p:weighted){p["weightPercent"]=r(n(p,"weightPercent"));p["equityWeightPercent"]=r(n(p,"equityWeightPercent"));rows.emplace_back(p);}
 return Object{{"totalAssets",r(total)},{"equityValue",r(equity)},{"cashBalance",r(cash)},{"cashPercent",r(total>0?cash/total*100:0)},{"top1Percent",r(top1)},{"top3Percent",r(top3)},{"hhi",equity>0?Value(r(hhi)):Value()},{"positionCount",rows.size()},{"level",level},{"positions",rows}};
}
// Strict Gregorian date prefix and ordinal: only supplied dates, never the device clock.
inline int dateOrdinal(const std::string& s){
 if(s.size()<10||s[4]!='-'||s[7]!='-')return -1;for(int i:{0,1,2,3,5,6,8,9})if(s[i]<'0'||s[i]>'9')return -1;
 int y=std::stoi(s.substr(0,4)),m=std::stoi(s.substr(5,2)),d=std::stoi(s.substr(8,2));if(y<1||m<1||m>12)return -1;bool leap=y%4==0&&(y%100!=0||y%400==0);int days[]={31,28,31,30,31,30,31,31,30,31,30,31};if(d<1||d>days[m-1]+(m==2&&leap?1:0))return -1;
 int previous=y-1,total=previous*365+previous/4-previous/100+previous/400+d;for(int i=1;i<m;++i)total+=days[i-1]+(i==2&&leap?1:0);return total;
}
inline Value drawdown(const Object& x){
 const auto& input=array(x,"snapshots");std::map<std::string,double> byDate;int excluded=0;
 for(const auto& sv:input){const auto& s=object(sv);std::string date=text(s,"snapshotDate").empty()?text(s,"snapshotAt"):text(s,"snapshotDate");const auto& assets=get(s,s.count("totalAssets")?"totalAssets":"totalValue");if(dateOrdinal(date)<0||!valid(assets)||std::get<double>(assets.data)<=0){++excluded;continue;}byDate[date.substr(0,10)]=std::get<double>(assets.data);}
 Array snapshots;double high=0,maximum=0,current=0;for(const auto& p:byDate){current=p.second;high=std::max(high,current);maximum=std::max(maximum,(high-current)/high*100);snapshots.emplace_back(Object{{"snapshotDate",p.first},{"totalAssets",current}});}
 int span=byDate.size()>1?dateOrdinal(byDate.rbegin()->first)-dateOrdinal(byDate.begin()->first):0;bool ready=byDate.size()>=3&&span>=30;std::string reason=byDate.size()<3?"至少需要 3 个不同日期的账户快照":span<30?"快照跨度不足 30 天":"";bool empty=byDate.empty();
 return Object{{"ready",ready},{"reason",reason},{"cashFlowAdjusted",false},{"metricLabel","总资产峰谷降幅（未剔除外部资金流）"},{"snapshotCount",byDate.size()},{"spanDays",span},{"maximumDrawdownPercent",empty?Value():Value(r(maximum))},{"recoveryPercent",empty||maximum>=100?Value():Value(r(maximum/(100-maximum)*100))},{"currentAssets",empty?Value():Value(r(current))},{"highWaterAssets",empty?Value():Value(r(high))},{"snapshots",snapshots},{"excludedCount",excluded}};
}
inline Value rebalance(const Object& x){
 double weight=positive(x,"maxWeightPercent"),l=lot(x);need(weight<100,"单股上限必须小于100%");Value concentration=risk(x);const auto& c=object(concentration);double total=n(c,"totalAssets"),max=total*weight/100;Array rows;
 for(const auto& pv:array(c,"positions")){const auto& p=object(pv);double v=n(p,"value");if(v<=max+.01)continue;double price=maybe(p,"currentPrice"),quantity=maybe(p,"quantity"),excess=v-max;bool known=std::isfinite(price)&&price>0&&std::isfinite(quantity)&&quantity>=0;double q=known?std::min(std::floor(quantity),std::floor(excess/price/l)*l):0;bool action=q>=l;
 rows.emplace_back(Object{{"code",text(p,"code")},{"name",text(p,"name")},{"currentWeightPercent",r(n(p,"weightPercent"))},{"maximumWeightPercent",r(weight)},{"excessValue",r(excess)},{"referencePrice",std::isfinite(price)&&price>0?Value(r(price,3)):Value()},{"paperQuantity",q},{"actionable",action},{"quantityKnown",known},{"note",action?"纸面测算，不会提交订单":"不足一手或缺少有效价格，不生成数量"}});}
 return Object{{"totalAssets",total},{"maxWeightPercent",r(weight)},{"lotSize",l},{"items",rows}};
}
inline Value stress(const Object& x){
 const auto& ps=array(x,"positions");Array defaults{-5,-10,-20};const auto& shocks=x.count("shocks")?array(x,"shocks",1,500):defaults;double cash=nonnegative(x,"cashBalance"),equity=0;for(const auto& p:ps)equity+=value(object(p));double start=cash+equity;Array rows;
 for(const auto& s:shocks){double shock=number(s,"冲击比例");need(shock>=-100,"股票跌幅不能超过100%");double e=equity*(1+shock/100),total=cash+e;rows.emplace_back(Object{{"shockPercent",r(shock)},{"equityValue",r(e)},{"totalAssets",r(total)},{"lossAmount",r(total-start)},{"lossPercent",start>0?r((total-start)/start*100):0}});}return Object{{"scenarios",rows}};
}
inline Value stopExposure(const Object& x){
 double total=positive(x,"totalAssets"),risk=0,coveredValue=0,allValue=0;const auto& ps=array(x,"positions");Array defaults;const auto& levels=x.count("levels")?array(x,"levels"):defaults;Array rows,missing,breached;std::map<std::string,Object> lm;for(const auto& lv:levels){const auto& l=object(lv);if(!text(l,"code").empty())lm[text(l,"code")]=l;}
 for(const auto& pv:ps){const auto& p=object(pv);std::string code=text(p,"code");double v=value(p);allValue+=v;auto it=lm.find(code);Object empty;const auto& l=it==lm.end()?empty:it->second;double price=maybe(p,"currentPrice"),quantity=maybe(p,"quantity"),stop=maybe(p,"stopPrice");std::string source="position-input";if(!(stop>0)){stop=maybe(l,"autoD2");source="auto-d2";}if(!(stop>0)){stop=maybe(l,"alertLow");source="alert-low";}
 if(!(price>0)||!(quantity>0)||!(stop>0)){missing.emplace_back(code);continue;}if(stop>=price){breached.emplace_back(code);continue;}double loss=(price-stop)*quantity;risk+=loss;coveredValue+=v;rows.emplace_back(Object{{"code",code},{"name",text(p,"name")},{"currentPrice",r(price,4)},{"stopPrice",r(stop,4)},{"source",source},{"quantity",std::floor(quantity)},{"riskAmount",r(loss)},{"riskPercent",r(loss/total*100,4)}});}
 return Object{{"knownRiskAmount",r(risk)},{"knownRiskPercent",r(risk/total*100,4)},{"positionCoveragePercent",ps.empty()?0:r(rows.size()*100.0/ps.size())},{"valueCoveragePercent",allValue>0?r(coveredValue/allValue*100):0},{"coveredCount",rows.size()},{"totalPositionCount",ps.size()},{"missingCodes",missing},{"breachedCodes",breached},{"rows",rows}};
}
inline Value ledger(const Object& x){
 const auto& closed=array(x,"closedPositions");const auto& trades=array(x,"trades");double costs=0,profit=0,loss=0,pnl=0,durations=0;int missingCost=0,count=0,wins=0,losses=0,durationCount=0;
 for(const auto& tv:trades){const auto& t=object(tv);double fee=maybe(t,"fee"),tax=maybe(t,"tax");if(!(fee>=0)||!(tax>=0))++missingCost;else costs+=fee+tax;}
 for(const auto& pv:closed){const auto& p=object(pv);double v=maybe(p,"realizedPnl");if(!std::isfinite(v))continue;++count;pnl+=v;if(v>0){++wins;profit+=v;}if(v<0){++losses;loss-=v;}int first=dateOrdinal(text(p,"firstTradeDate")),last=dateOrdinal(text(p,"lastTradeDate"));if(first>=0&&last>=first){durations+=last-first;++durationCount;}}
 double aw=wins?profit/wins:0,al=losses?loss/losses:0;
 return Object{{"ready",count>0},{"reason",count==0?"尚无已关闭股票样本":count<20?"样本较少，仅用于描述，不代表稳定胜率":""},{"sampleCount",count},{"winCount",wins},{"lossCount",losses},{"breakEvenCount",count-wins-losses},{"winRatePercent",count?Value(r(wins*100.0/count)):Value()},{"averageWin",wins?Value(r(aw)):Value()},{"averageLoss",losses?Value(r(al)):Value()},{"payoffRatio",wins&&losses&&al!=0?Value(r(aw/al)):Value()},{"profitFactor",loss>0?Value(r(profit/loss)):Value()},{"expectancy",count?Value(r(pnl/count)):Value()},{"averageHoldingDays",durationCount?Value(r(durations/durationCount)):Value()},{"recordedCosts",missingCost==0?Value(r(costs)):Value()},{"knownRecordedCosts",r(costs)},{"missingCostCount",missingCost},{"excludedCount",double(closed.size())-count},{"sampleUnit","按股票全历史汇总"}};
}
inline Value cost(const Object& x){double capital=nonnegative(x,"initialCapital"),turnover=nonnegative(x,"annualTurnoverPercent"),fee=nonnegative(x,"effectiveFeeRatePercent"),years=positive(x,"years");need(years<=50,"期限不能超过50年");double drag=turnover/100*fee/100;need(drag<1,"年费用率必须小于100%");double remaining=capital*std::pow(1-drag,years);return Object{{"annualDragPercent",r(drag*100,4)},{"remainingCapital",r(remaining)},{"cumulativeCost",r(capital-remaining)},{"assumption","固定本金路径下的简化换手费用估算，不含收益、滑点与税制变化"}};}
inline Value positionSize(const Object& x){
 double equity=positive(x,"equity"),cash=nonnegative(x,"availableCash"),risk=positive(x,"riskPercent"),entry=positive(x,"entryPrice"),stop=positive(x,"stopPrice"),max=positive(x,"maxPositionPercent"),buffer=optional(x,"riskBufferPerShare",0),l=lot(x);need(risk<=100&&max<=100&&stop<entry&&buffer>=0,"风险、止损或仓位参数无效");double budget=equity*risk/100,perShare=entry-stop+buffer,cap=std::min(cash,equity*max/100),rq=std::floor(budget/perShare/l)*l,cq=std::floor(cap/entry/l)*l,q=std::min(rq,cq);need(std::isfinite(rq)&&std::isfinite(cq)&&std::max(rq,cq)<=9e15,"数量超出精确整数范围");std::string binding=rq==cq?"both":rq<cq?"risk-budget":cash<equity*max/100?"available-cash":"position-cap";
 return Object{{"riskBudget",r(budget)},{"riskPerShare",r(perShare,4)},{"capitalBudget",r(cap)},{"riskLimitedQuantity",rq},{"capitalLimitedQuantity",cq},{"quantity",q},{"positionValue",r(q*entry)},{"actualRisk",r(q*perShare)},{"positionWeightPercent",r(q*entry/equity*100)},{"bindingConstraint",binding}};
}
inline Value riskReward(const Object& x){double entry=positive(x,"entryPrice"),stop=positive(x,"stopPrice"),target=positive(x,"targetPrice"),cost=nonnegative(x,"roundTripCostPerShare");need(stop<entry&&target>entry,"止损须低于入场，目标须高于入场");double risk=entry-stop+cost,reward=target-entry-cost;need(reward>0,"成本后目标收益必须大于0");return Object{{"netRiskPerShare",r(risk,6)},{"netRewardPerShare",r(reward,6)},{"rewardRiskRatio",r(reward/risk,6)},{"breakEvenWinRatePercent",r(risk/(risk+reward)*100,6)},{"stopLossPercent",r((entry-stop)/entry*100,4)},{"targetGainPercent",r((target-entry)/entry*100,4)}};}
inline Value expectancy(const Object& x){double win=nonnegative(x,"winRatePercent"),loss=nonnegative(x,"lossRatePercent"),aw=nonnegative(x,"averageWin"),al=nonnegative(x,"averageLoss");need(win<=100&&loss<=100&&win+loss>0&&win+loss<=100&&aw+al>0,"概率合计或平均盈亏无效");double profit=win/100*aw,cost=loss/100*al,conditional=al/(aw+al)*100;return Object{{"expectedValue",r(profit-cost,6)},{"profitFactor",cost>0?Value(r(profit/cost,6)):Value()},{"breakEvenWinRatePercent",r(conditional*(win+loss)/100,6)},{"conditionalBreakEvenWinRatePercent",r(conditional,6)},{"flatRatePercent",r(100-win-loss,6)},{"assumption","user-entered-outcome-rates"}};}
inline Value readiness(const Object& x){
 Value dv=drawdown(x),lv=ledger(x);const auto& d=object(dv);const auto& l=object(lv);int count=int(n(l,"sampleCount")),positionCount=int(array(x,"positions").size()),tradeCount=int(array(x,"trades").size());for(const auto& p:array(x,"positions"))value(object(p));bool ready=std::get<bool>(get(d,"ready").data);
 return Object{{"targetPath",Object{{"status","ready"},{"detail","确定性数学计算，可立即使用；不是收益预测"}}},{"snapshotHistory",Object{{"status",ready?"ready":"insufficient"},{"detail",ready?std::to_string(int(n(d,"snapshotCount")))+" 个快照，跨度 "+std::to_string(int(n(d,"spanDays")))+" 天；未剔除外部资金流":text(d,"reason")}}},{"tradeLedger",Object{{"status",count>=20?"ready":count>0?"limited":"insufficient"},{"detail",std::to_string(count)+" 个已关闭股票汇总 · "+std::to_string(tradeCount)+" 条交易记录"}}},{"currentPortfolio",Object{{"status",positionCount>0?"ready":"insufficient"},{"detail",positionCount>0?std::to_string(positionCount)+" 只当前持仓":"没有当前持仓，无法计算结构风险"}}},{"commentMethods",Object{{"status","validation-required"},{"detail","评论只作为方法线索；需明确标的、方向、时间与退出规则后才能回测"}}}};
}
inline Value lossPath(const Object& x){double initial=positive(x,"initialEquity"),risk=positive(x,"riskPercent");need(risk<100,"风险比例必须小于100%");int count=integer(x,"consecutiveLosses",0,1000);double equity=initial;Array points{Object{{"step",0},{"equity",r(equity)},{"lossAmount",0}}};for(int i=1;i<=count;++i){double loss=equity*risk/100;equity-=loss;points.emplace_back(Object{{"step",i},{"equity",r(equity)},{"lossAmount",r(loss)}});}double d=(initial-equity)/initial*100;return Object{{"initialEquity",r(initial)},{"finalEquity",r(equity)},{"drawdownPercent",r(d)},{"recoveryPercent",d>=100?Value():Value(r(d/(100-d)*100))},{"points",points},{"recoveryUnavailable",d>=100}};}
inline Value lossRun(const Object& x){
 double win=nonnegative(x,"winRatePercent");need(win<=100,"胜率不能超过100%");int n=integer(x,"trialCount",1,5000),k=integer(x,"streakLength",1,100);double p=win/100,q=1-p,probability=0;
 if(k<=n){std::vector<double> states(k,0);states[0]=1;for(int i=0;i<n;++i){double sum=0;for(double s:states)sum+=s;std::vector<double> next(k,0);next[0]=sum*p;for(int j=0;j<k-1;++j)next[j+1]+=states[j]*q;states=std::move(next);}double noRun=0;for(double s:states)noRun+=s;probability=std::max(0.0,std::min(1.0,1-noRun));}
 return Object{{"nextStreakProbabilityPercent",r(std::pow(q,k)*100,6)},{"atLeastOneStreakProbabilityPercent",r(probability*100,6)},{"assumption","independent-identically-distributed"},{"trialCount",n},{"streakLength",k}};
}
inline double quantile(const std::vector<double>& a,double p){double at=(a.size()-1)*p;auto lo=std::size_t(std::floor(at));return a[lo]+(at-lo)*(a[std::min(lo+1,a.size()-1)]-a[lo]);}
inline Value pnlDistribution(const Object& x){const auto& input=array(x,"values",1,500);std::vector<double> values;double sum=0;int wins=0,losses=0;for(const auto& v:input){double d=number(v,"盈亏样本");values.push_back(d);sum+=d;if(d>0)++wins;if(d<0)++losses;}std::sort(values.begin(),values.end());double mean=sum/values.size(),ss=0;for(double v:values)ss+=(v-mean)*(v-mean);double q1=quantile(values,.25),q3=quantile(values,.75);return Object{{"sampleCount",values.size()},{"mean",r(mean,6)},{"median",r(quantile(values,.5),6)},{"q1",r(q1,6)},{"q3",r(q3,6)},{"iqr",r(q3-q1,6)},{"sampleStandardDeviation",values.size()>1?Value(r(std::sqrt(ss/(values.size()-1)),6)):Value()},{"winCount",wins},{"lossCount",losses},{"flatCount",double(values.size())-wins-losses},{"minimum",r(values.front(),6)},{"maximum",r(values.back(),6)},{"quantileMethod","R7"}};}
inline Value equityPath(const Object& x){double initial=positive(x,"initialCapital"),equity=initial,high=initial,maximum=0;const auto& values=array(x,"pnlValues",1,500);Array points{Object{{"step",0},{"pnl",0},{"equity",r(initial)},{"drawdownPercent",0}}};int start=-1,longest=0,count=0;for(std::size_t i=0;i<values.size();++i){double pnl=number(values[i],"盈亏样本");equity+=pnl;int step=int(i)+1;if(equity>=high){if(start>=0)longest=std::max(longest,step-start+1);high=equity;start=-1;}else{++count;if(start<0)start=step;}double d=(high-equity)/high*100;maximum=std::max(maximum,d);points.emplace_back(Object{{"step",step},{"pnl",r(pnl)},{"equity",r(equity)},{"drawdownPercent",r(d,6)}});}if(start>=0)longest=std::max(longest,int(values.size())-start+1);return Object{{"initialCapital",r(initial)},{"finalCapital",r(equity)},{"netPnl",r(equity-initial)},{"maximumDrawdownPercent",r(maximum,6)},{"longestUnderwaterSpan",longest},{"underwaterObservationCount",count},{"capitalDepleted",equity<=0},{"points",points}};}
} // detail
inline Value evaluate(const std::string& module,const Value& input){
 auto it=std::find(modules.begin(),modules.end(),module);detail::need(it!=modules.end(),"未知情景工具");const auto& x=detail::object(input);Value result;
 if(module=="target")result=detail::target(x);else if(module=="recovery")result=detail::recovery(x);else if(module=="cashBuffer")result=detail::cashBuffer(x);else if(module=="stagedAverage")result=detail::stagedAverage(x);else if(module=="breakEven")result=detail::breakEven(x);else if(module=="risk")result=detail::risk(x);else if(module=="drawdown")result=detail::drawdown(x);else if(module=="rebalance")result=detail::rebalance(x);else if(module=="stress")result=detail::stress(x);else if(module=="stopExposure")result=detail::stopExposure(x);else if(module=="ledger")result=detail::ledger(x);else if(module=="cost")result=detail::cost(x);else if(module=="positionSize")result=detail::positionSize(x);else if(module=="riskReward")result=detail::riskReward(x);else if(module=="expectancy")result=detail::expectancy(x);else if(module=="readiness")result=detail::readiness(x);else if(module=="lossPath")result=detail::lossPath(x);else if(module=="lossRun")result=detail::lossRun(x);else if(module=="pnlDistribution")result=detail::pnlDistribution(x);else result=detail::equityPath(x);
 detail::finite(result);return Object{{"model","scenario-tools/v1"},{"module",module},{"title",titles[std::size_t(it-modules.begin())]},{"boundary","仅按明确输入计算的情景，不是收益预测、买卖建议或订单；未自动读取账户。"},{"result",result}};
}
}
