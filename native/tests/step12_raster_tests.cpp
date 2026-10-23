#include "candle_raster.hpp"
#include <cstdio>

int main(int argc,char** argv){QApplication app(argc,argv);QJsonArray rows;
 for(int i=0;i<50000;++i){const double close=100.+(i%211)*.01;QJsonObject r{{"close",close},{"open",close+(i%3-1)*.5},{"high",close+1},{"low",close-1}};
  if(i%17==0)r["close"]=QJsonValue::Null;else if(i%19==0)r["close"]=0.;else if(i%23==0)r["open"]=QJsonValue::Null;else if(i%29==0)r.remove("high");rows.append(r);
 }
 int cases=0;for(qreal dpr:{1.,1.25,1.5,2.})for(int count:{64,50000})for(int width:{641,997}){
  QImage base(QSize(qCeil(width*dpr),qCeil(503*dpr)),QImage::Format_RGB32);base.setDevicePixelRatio(dpr);base.fill(QColor("#191b20"));
  candleRaster::View view{rows,QRectF(75,38,width-95,395),0,count,count,98,104,QColor("#ff7188"),QColor("#16ceb0"),QColor("#95b8fc")};
  QImage reference=base.copy();{QPainter p(&reference);p.setRenderHint(QPainter::Antialiasing);candleRaster::draw(p,view,0,count);}
  QElapsedTimer timer;timer.start();auto result=candleRaster::parallel(base,view);double ms=timer.nsecsElapsed()/1e6;
  if(result.isNull()||result!=reference){std::fprintf(stderr,"FAIL dpr=%g rows=%d width=%d\n",dpr,count,width);return 1;}
  std::printf("PASS dpr=%g rows=%d width=%d complete_ms=%.3f\n",dpr,count,width,ms);++cases;
 }
 for(int first:{123,19001}){
  QImage base(997,503,QImage::Format_RGB32);base.fill(QColor("#191b20"));
  candleRaster::View view{rows,QRectF(75,38,902,395),first,first+20000,20000,98,104,Qt::red,Qt::green,Qt::blue};
  auto reference=base.copy();{QPainter p(&reference);p.setRenderHint(QPainter::Antialiasing);candleRaster::draw(p,view,view.first,view.end);}
  if(candleRaster::parallel(base,view)!=reference)return 2;
  if(!candleRaster::parallel(base,view,1).isNull())return 3;
  if(!candleRaster::parallel(base.convertToFormat(QImage::Format_ARGB32),view).isNull())return 4;
  QImage oversized(3000,2000,QImage::Format_RGB32);
  if(!candleRaster::parallel(oversized,view).isNull())return 5;
  ++cases;
 }
 std::printf("PASS %d strip equivalence cases plus single-worker format and memory fallbacks\n",cases);return 0;
}
