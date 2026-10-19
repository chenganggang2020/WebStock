#pragma once
#include "legacy_indicators.hpp"
#include <functional>
#include <limits>
namespace chartAnnotations {
struct Point {market::Bar bar;std::string date;double availableAt=NAN,closedAt=NAN;};
struct Context {std::string source,instrument,period,adjustment="unknown",volumeUnit="unknown";double asOf=NAN;};
struct Touch {int index=-1,confirmedIndex=-1;std::string date;double price=NAN;bool rejected=false,volumeConfirmed=false;};
struct Level {bool present=false;std::string type,strength,status;double price=NAN,distancePct=NAN,tolerance=NAN;int rejectionCount=0,volumeConfirmedTouches=0;std::vector<Touch> touches;};
struct Validation {std::string status="pending";int bars=0;double forwardClosePct=NAN,maxPct=NAN,minPct=NAN;};
struct Event {int index=-1;std::string date,type,direction;double price=NAN,close=NAN,threshold=NAN,volumeRatio=NAN,priceChangePct=NAN,dependenciesAvailableAt=NAN;std::string triggerAvailability="unproven-at-bar-close";Validation validation;};
struct Result {std::string status="unavailable",reason;Context context;int selected=-1,lookbackBars=0;bool snapshotOnly=true;double pivot=NAN,r1=NAN,s1=NAN,r1DistancePct=NAN,s1DistancePct=NAN,tolerance=NAN,tolerancePct=NAN;std::string sourceDate;Level support,resistance;std::vector<Event> events;std::vector<std::string> exclusions;};
inline double fixed(double value,int digits=2){if(digits!=3)return market::legacy_detail::fixed(value,digits);if(!std::isfinite(value)||value==0||std::abs(value)>=1e21)return value;int exponent=0;double fraction=std::frexp(std::abs(value),&exponent);std::uint64_t scaled=static_cast<std::uint64_t>(std::ldexp(fraction,53))*125;int shift=50-exponent;if(shift<=0)return value;if(shift>=64)return std::copysign(0.0,value);auto integer=scaled>>shift;if((scaled&((std::uint64_t{1}<<shift)-1))>=(std::uint64_t{1}<<(shift-1)))++integer;return std::copysign(double(integer)/1000,value);}
inline bool volume(double n){return std::isfinite(n)&&n>=0;}
inline void active(const std::function<bool()>& cancelled){if(cancelled&&cancelled())throw std::runtime_error("cancelled");}
inline Level clustered(std::vector<Touch> points,bool support,double close,double tolerance){
 struct Cluster {double price;std::vector<Touch> touches;};std::vector<Cluster> clusters;
 std::stable_sort(points.begin(),points.end(),[](const Touch&a,const Touch&b){return a.price<b.price;});
 for(auto p:points){auto it=std::find_if(clusters.begin(),clusters.end(),[&](const Cluster&c){return std::abs(c.price-p.price)<=tolerance;});if(it==clusters.end()){clusters.push_back({p.price,{}});it=clusters.end()-1;}it->touches.push_back(p);double total=0;for(auto t:it->touches)total+=t.price;it->price=total/it->touches.size();}
 clusters.erase(std::remove_if(clusters.begin(),clusters.end(),[&](const Cluster&c){return support?c.price>close+tolerance:c.price<close-tolerance;}),clusters.end());
 std::stable_sort(clusters.begin(),clusters.end(),[&](const Cluster&a,const Cluster&b){double x=std::abs(close-a.price),y=std::abs(close-b.price);return x==y?a.touches.size()>b.touches.size():x<y;});
 Level out;if(clusters.empty())return out;auto c=clusters.front();out.present=true;out.type=support?"support":"resistance";out.price=fixed(c.price);out.distancePct=fixed((out.price-close)/close*100);out.tolerance=fixed(tolerance,4);out.touches=c.touches;
 for(auto t:c.touches){out.rejectionCount+=t.rejected;out.volumeConfirmedTouches+=t.volumeConfirmed;}
 out.strength=c.touches.size()>=3&&out.rejectionCount>=2?"strong":c.touches.size()>=2?"moderate":"weak";
 out.status=std::abs(close-out.price)<=tolerance?"testing":support?(close<out.price-tolerance?"broken-down":"holding-above"):(close>out.price+tolerance?"broken-up":"holding-below");return out;
}
inline Result calculate(const std::vector<Point>& points,const Context&context,int selected,const std::function<bool()>& cancelled={}){
 active(cancelled);Result out;out.context=context;out.selected=selected;
 if(points.size()>10000){out.reason="bar-limit-10000";return out;}
 out.exclusions.resize(points.size());if(context.source.empty()||context.instrument.empty()||context.period.empty()||!std::isfinite(context.asOf)||context.asOf<0||context.asOf>253402214400000.0){out.reason="source-instrument-period-asof-required";return out;}
 double previous=-INFINITY;std::vector<bool> ok(points.size());out.snapshotOnly=false;
 for(size_t i=0;i<points.size();++i){active(cancelled);auto&p=points[i];auto&b=p.bar;if(!std::isfinite(b.time)||b.time<0||b.time>253402214400000.0||b.time<=previous){out.reason="non-increasing-time";return out;}previous=b.time;
  auto&why=out.exclusions[i];if(!market::valid(b))why="data-gap";else if(!b.closed)why="unclosed-period";else if(b.time>context.asOf)why="future-time";else if((std::isfinite(p.availableAt)&&p.availableAt<b.time)||(std::isfinite(p.closedAt)&&p.closedAt<b.time))why="invalid-evidence-time";else if(std::isfinite(p.availableAt)&&p.availableAt>context.asOf)why="future-availability";else if(std::isfinite(p.closedAt)&&p.closedAt>context.asOf)why="future-close";
  if(!std::isfinite(p.availableAt))out.snapshotOnly=true;ok[i]=why.empty();
 }
 if(selected<0||selected>=int(points.size())){out.reason="select-a-bar";return out;}if(!ok[selected]){out.reason=out.exclusions[selected];return out;}
 out.status="available";auto&last=points[selected].bar;int begin=selected;while(begin>0&&ok[begin-1])--begin;
 if(selected-begin>=1){auto&prev=points[selected-1];double pivot=(prev.bar.high+prev.bar.low+prev.bar.close)/3;out.pivot=fixed(pivot);out.r1=fixed(2*pivot-prev.bar.low);out.s1=fixed(2*pivot-prev.bar.high);out.r1DistancePct=fixed((2*pivot-prev.bar.low-last.close)/last.close*100);out.s1DistancePct=fixed((2*pivot-prev.bar.high-last.close)/last.close*100);out.sourceDate=prev.date;}
 int start=std::max(begin,selected-120);out.lookbackBars=selected-start;
 if(out.lookbackBars>=10){double sum=0;int trStart=std::max(start,selected-14);for(int i=trStart;i<selected;++i){auto&b=points[i].bar;double range=b.high-b.low;if(i>start)range=std::max({range,std::abs(b.high-points[i-1].bar.close),std::abs(b.low-points[i-1].bar.close)});sum+=range;}double tolerance=std::max(last.close*.005,sum/(selected-trStart)*.35);out.tolerance=fixed(tolerance,4);out.tolerancePct=fixed(tolerance/last.close*100,3);std::vector<Touch> lows,highs;
  for(int i=start+2;i<selected-2;++i){active(cancelled);auto&b=points[i].bar;bool low=true,high=true;for(int j=i-2;j<=i+2;++j)if(j!=i){low=low&&b.low<points[j].bar.low;high=high&&b.high>points[j].bar.high;}
   double volumeSum=0;int volumes=0;for(int j=std::max(start,i-20);j<i;++j)if(volume(points[j].bar.volume)){volumeSum+=points[j].bar.volume;++volumes;}bool confirmed=volumes>=5&&volumeSum>0&&volume(b.volume)&&b.volume>=volumeSum/volumes*1.2;
   if(low)lows.push_back({i,i+2,points[i].date,b.low,b.close>=b.low+(b.high-b.low)*.5,confirmed});if(high)highs.push_back({i,i+2,points[i].date,b.high,b.close<=b.high-(b.high-b.low)*.5,confirmed});
  }out.support=clustered(lows,true,last.close,tolerance);out.resistance=clustered(highs,false,last.close,tolerance);
 }
 int consecutive=0;for(int i=0;i<=selected;++i){active(cancelled);consecutive=ok[i]?consecutive+1:0;if(consecutive<21)continue;auto&b=points[i].bar;auto&prev=points[i-1].bar;double high=-INFINITY,low=INFINITY,total=0;bool allVolumes=true;for(int j=i-20;j<i;++j){high=std::max(high,points[j].bar.high);low=std::min(low,points[j].bar.low);allVolumes=allVolumes&&volume(points[j].bar.volume);total+=points[j].bar.volume;}
  double ratio=allVolumes&&total>0&&volume(b.volume)?b.volume/(total/20):NAN,change=(b.close-prev.close)/prev.close*100;Event e;e.index=i;e.date=points[i].date;e.close=fixed(b.close);e.volumeRatio=fixed(ratio);e.priceChangePct=fixed(change);
  if(b.close>high){e.type="breakout-up";e.direction="positive";e.threshold=high;}else if(b.close<low){e.type="breakout-down";e.direction="negative";e.threshold=low;}else if(b.low>prev.high){e.type="gap-up";e.direction="positive";e.threshold=prev.high;}else if(b.high<prev.low){e.type="gap-down";e.direction="negative";e.threshold=prev.low;}else if(std::isfinite(ratio)&&ratio>=1.8&&std::abs(change)>=1){e.type=change>=0?"volume-expansion-up":"volume-expansion-down";e.direction=change>=0?"positive":"negative";e.threshold=total/20;}else continue;
  bool allAvailable=true;double available=0;for(int j=i-20;j<=i;++j){allAvailable=allAvailable&&std::isfinite(points[j].availableAt);if(std::isfinite(points[j].availableAt))available=std::max(available,points[j].availableAt);}if(allAvailable){e.dependenciesAvailableAt=available;if(std::isfinite(points[i].closedAt))e.triggerAvailability=available<=points[i].closedAt?"declared-available-by-bar-close":"later-available-reconstruction";}
  e.price=e.direction=="positive"?b.low:b.high;e.threshold=fixed(e.threshold);double max=-INFINITY,min=INFINITY;int lastFuture=i;for(int j=i+1;j<int(points.size())&&j<=i+5&&ok[j];++j){active(cancelled);++e.validation.bars;lastFuture=j;max=std::max(max,points[j].bar.high);min=std::min(min,points[j].bar.low);}
  if(e.validation.bars){e.validation.status=e.validation.bars==5?"available":"partial";e.validation.forwardClosePct=fixed((points[lastFuture].bar.close-b.close)/b.close*100);e.validation.maxPct=fixed((max-b.close)/b.close*100);e.validation.minPct=fixed((min-b.close)/b.close*100);}out.events.push_back(e);
 }if(out.events.size()>16)out.events.erase(out.events.begin(),out.events.end()-16);return out;
}
}
