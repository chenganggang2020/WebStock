#pragma once
#include <QtWidgets>
#include <algorithm>
#include <cstring>
#include <future>
#include <vector>

namespace candleRaster {
struct View {
 QJsonArray rows;QRectF chart;int first=0,end=0,count=0;double low=0,high=1;QColor up,down,line;
};
inline void draw(QPainter& p,const View& v,int first,int end){
 const auto y=[&](double price){return v.chart.bottom()-(price-v.low)/(v.high-v.low)*v.chart.height();};
 const auto x=[&](int index){return v.chart.left()+v.chart.width()*(index-v.first+.5)/std::max(1,v.count);};
 const double width=std::clamp(v.chart.width()/std::max(1,v.count)*.68,1.,18.);
 const QPen upPen(v.up,1),downPen(v.down,1);const QBrush upBrush(v.up),downBrush(v.down);
 for(int i=first;i<end;++i){const auto r=v.rows.at(i).toObject();const auto close=r[QStringLiteral("close")];if(!close.isDouble()||close.toDouble()<=0)continue;const double px=x(i);const QPointF point(px,y(close.toDouble()));
  const auto open=r[QStringLiteral("open")],hi=r[QStringLiteral("high")],lo=r[QStringLiteral("low")];
  if(open.isDouble()&&hi.isDouble()&&lo.isDouble()){const bool rising=close.toDouble()>=open.toDouble();p.setPen(rising?upPen:downPen);p.drawLine(QPointF(px,y(hi.toDouble())),QPointF(px,y(lo.toDouble())));const double openY=y(open.toDouble());const auto top=std::min(openY,point.y()),bottom=std::max(openY,point.y());p.fillRect(QRectF(px-width/2,top,width,std::max(1.,bottom-top)),rising?upBrush:downBrush);}
  else{p.setPen(v.line);p.drawEllipse(point,2,2);}
 }
}

// Each worker owns a full-coordinate image so Qt's antialias rounding is
// unchanged. Only its disjoint physical-pixel strip is copied into the result.
// All futures finish before return; no QWidget access or queued publication.
inline QImage parallel(const QImage& background,const View& view,int requested=8){
 constexpr qsizetype budget=32*1024*1024;
 const auto bytes=background.sizeInBytes();const qreal dpr=background.devicePixelRatio();
 if(background.isNull()||background.format()!=QImage::Format_RGB32||bytes<=0||bytes>budget/3||view.count<=0||view.chart.width()<=0)return {};
 const int workers=std::min({requested,8,std::max(1,QThread::idealThreadCount()),int(budget/bytes)-1,background.width()});
 if(workers<2)return {};
 QImage result=background.copy();if(result.isNull())return {};
 std::vector<std::future<QImage>> jobs;jobs.reserve(workers);
 try{
  for(int k=0;k<workers;++k){const int left=background.width()*k/workers,right=background.width()*(k+1)/workers;
   QImage image=background.copy();if(image.isNull())return {};
   jobs.push_back(std::async(std::launch::async,[image=std::move(image),view,left,right,dpr]()mutable{
    // Include all primitives that can touch the strip, including fallback
    // ellipses, square line caps, and fractional-DPR antialias fringes.
    const double pad=std::clamp(view.chart.width()/std::max(1,view.count)*.68,1.,18.)/2+4;
    auto index=[&](double px){return view.first+(px-view.chart.left())/view.chart.width()*view.count-.5;};
    const int begin=std::clamp(int(std::floor(index(left/dpr-pad)))-1,view.first,view.end);
    const int end=std::clamp(int(std::ceil(index(right/dpr+pad)))+2,begin,view.end);
    QPainter p(&image);p.setRenderHint(QPainter::Antialiasing);draw(p,view,begin,end);p.end();return image;
   }));
  }
  for(int k=0;k<workers;++k){const QImage image=jobs[k].get();const int left=background.width()*k/workers,right=background.width()*(k+1)/workers;
   for(int y=0;y<result.height();++y)std::memcpy(result.scanLine(y)+left*4,image.constScanLine(y)+left*4,(right-left)*4);
  }
 }catch(const std::exception&){return {};}
 return result;
}
}
