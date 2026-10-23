#include <QtWidgets>
#include <cstdio>
#include <algorithm>

// Focused differential check for the changed drawing loop. The real page probe
// separately checks sources, readouts, viewport identity and 44 complete frames.
QImage draw(QJsonArray rows,bool minute,bool optimized,qreal dpr,int visible){
 QImage image(QSize(640*dpr,360*dpr),QImage::Format_RGB32);image.setDevicePixelRatio(dpr);image.fill(QColor("#191b20"));
 QPainter p(&image);p.setRenderHint(QPainter::Antialiasing);
 const QColor up("#ff7188"),down("#16ceb0"),line("#95b8fc");
 const QPen upPen(up,1),downPen(down,1),minutePen(line,1.5);const QBrush upBrush(up),downBrush(down);
 const double width=std::clamp(600./visible*.68,1.,18.);
 auto x=[&](int i){return 20.+600.*(i+.5)/visible;};auto y=[](double price){return 340.-(price-80.)/40.*320.;};
 bool lastValid=false;QPointF last;
 for(int i=0;i<visible;++i){const auto r=rows.at(i).toObject();const auto close=r["close"];if(!close.isDouble()||close.toDouble()<=0){lastValid=false;continue;}const QPointF point(x(i),y(close.toDouble()));
  if(minute){p.setPen(optimized?minutePen:QPen(line,1.5));if(lastValid)p.drawLine(last,point);else p.drawEllipse(point,1.5,1.5);last=point;lastValid=true;}
  else{const auto open=r["open"],highValue=r["high"],lowValue=r["low"];if(open.isDouble()&&highValue.isDouble()&&lowValue.isDouble()){
   const bool rising=close.toDouble()>=open.toDouble();const auto color=rising?up:down;p.setPen(optimized?(rising?upPen:downPen):QPen(color,1));
   p.drawLine(QPointF(x(i),y(highValue.toDouble())),QPointF(x(i),y(lowValue.toDouble())));
   const double openY=y(open.toDouble());const auto top=std::min(openY,point.y()),bottom=std::max(openY,point.y());
   QRectF rect(x(i)-width/2,top,width,std::max(1.,bottom-top));if(optimized)p.fillRect(rect,rising?upBrush:downBrush);else p.fillRect(rect,color);
  }else{p.setPen(line);p.drawEllipse(point,2,2);}}
 }
 return image;
}
int main(int argc,char** argv){QApplication app(argc,argv);QJsonArray rows;
 for(int i=0;i<50000;++i){double close=100.+(i%21)*.1;QJsonObject r{{"close",close},{"open",close+(i%3-1)*.5},{"high",close+2.},{"low",close-2.}};
  if(i%17==0)r["close"]=QJsonValue::Null;else if(i%19==0)r["close"]=0.;else if(i%23==0)r["open"]=QJsonValue::Null;else if(i%29==0)r.remove("high");rows.append(r);
 }
 int cases=0;for(qreal dpr:{1.,1.25,2.})for(int visible:{64,50000})for(bool minute:{false,true}){
  if(draw(rows,minute,false,dpr,visible)!=draw(rows,minute,true,dpr,visible)){std::fprintf(stderr,"FAIL dpr=%g rows=%d minute=%d\n",dpr,visible,minute);return 1;}++cases;
 }
 std::printf("PASS %d exact RGBA differential cases: up/down/doji/null/zero/missing OHLC, DPR 1/1.25/2, 64/50000 rows, daily/minute\n",cases);return 0;
}
