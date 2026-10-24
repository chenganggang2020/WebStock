#pragma once
#include <QMap>
#include <QPainter>
#include <QPainterPath>
#include <QVector>
#include <cmath>
#include <functional>
#include <algorithm>

// Host drawing primitives. No engine, strategy, or plugin identifiers belong here.
namespace chartExtension {
struct Line { QString name; QColor color; QVector<QPointF> points; };
struct Marker { int index=-1; double price=0; QString shape, text, category; QColor color; QString id,label; };
struct Segment { QPointF from,to; QColor color; QString id; };
struct Layer { QVector<Line> lines; QVector<Marker> markers; QVector<Segment> segments; QString selectedId; };
struct Hit { QString owner,id; };
inline void range(const QMap<QString,Layer>& layers,int start,int end,double& lo,double& hi) {
  auto include=[&](QPointF p){if(p.x()>=start&&p.x()<end&&std::isfinite(p.y())){lo=std::min(lo,p.y());hi=std::max(hi,p.y());}};
  for(const auto& layer:layers){for(const auto& line:layer.lines)for(auto p:line.points)include(p);for(const auto&m:layer.markers)include({double(m.index),m.price});
    for(const auto&s:layer.segments){if(s.to.x()<start||s.from.x()>=end)continue;
      for(double at:{qMax(double(start),s.from.x()),qMin(double(end-1),s.to.x())}){
        double t=s.to.x()==s.from.x()?0:(at-s.from.x())/(s.to.x()-s.from.x());include({at,s.from.y()+t*(s.to.y()-s.from.y())});}
    }
  }
}
inline double distance(QPointF point,QPointF a,QPointF b){
  auto v=b-a;double length=v.x()*v.x()+v.y()*v.y();
  double t=length?std::clamp(QPointF::dotProduct(point-a,v)/length,0.,1.):0;
  auto d=point-(a+t*v);return std::hypot(d.x(),d.y());
}
// Hit testing uses the same price transform as painting; it is not a date-only
// selection, and remains accurate after zooming, scrolling and resizing.
inline Hit hitTest(QPointF at,const QRectF& rect,const QMap<QString,Layer>& layers,int start,int end,
                   const std::function<double(int)>& x,const std::function<double(double)>& y){
  if(!rect.contains(at))return {};
  Hit best;double nearest=10;
  for(auto it=layers.end();it!=layers.begin();){--it;for(const auto&m:it->markers){
    if(m.id.isEmpty()||m.index<start||m.index>=end)continue;
    double d=distance(at,{x(m.index),y(m.price)},{x(m.index),y(m.price)});
    if(d<nearest){nearest=d;best={it.key(),m.id};}
  }}
  if(!best.id.isEmpty())return best;
  nearest=7;
  for(auto it=layers.end();it!=layers.begin();){--it;for(const auto&s:it->segments){
    if(s.id.isEmpty()||s.to.x()<start||s.from.x()>=end)continue;
    double d=distance(at,{x(int(s.from.x())),y(s.from.y())},{x(int(s.to.x())),y(s.to.y())});
    if(d<nearest){nearest=d;best={it.key(),s.id};}
  }}return best;
}
inline void paint(QPainter& p,const QRectF& rect,const QMap<QString,Layer>& layers,int start,int end,
                  const std::function<double(int)>& x,const std::function<double(double)>& y,const QColor& background) {
  p.save();p.setClipRect(rect);
  for(const auto& layer:layers){
    for(const auto& line:layer.lines){QPainterPath path;bool joined=false;int prior=-2;
      for(auto at:line.points){int i=int(at.x());if(i<start||i>=end||!std::isfinite(at.y())){joined=false;continue;}
        QPointF point(x(i),y(at.y()));if(joined&&i==prior+1)path.lineTo(point);else path.moveTo(point);joined=true;prior=i;}
      p.setPen(QPen(line.color,1.7));p.setBrush(Qt::NoBrush);p.drawPath(path);
    }
    // Paint the selected connection last so an overlapping line cannot hide it.
    for(bool selected:{false,true})for(const auto&s:layer.segments){
      if(s.to.x()<start||s.from.x()>=end||(s.id==layer.selectedId&&!s.id.isEmpty())!=selected)continue;
      auto tone=s.color;tone.setAlpha(255);
      QPointF a(x(int(s.from.x())),y(s.from.y())),b(x(int(s.to.x())),y(s.to.y()));
      // A narrow backdrop separates the connection from candles and indicators.
      // Ordinary trades stay clearly visible even when none is selected.
      const double width=selected?4.2:2.8;
      p.setPen(QPen(background,width+2,Qt::SolidLine,Qt::RoundCap));p.drawLine(a,b);
      QPen connection(tone,width,Qt::SolidLine,Qt::RoundCap);
      if(!selected)connection.setDashPattern({3,1.6});
      p.setPen(connection);p.drawLine(a,b);
      if(selected){p.setBrush(Qt::NoBrush);p.drawEllipse(a,9,9);p.drawEllipse(b,9,9);}
    }
    for(const auto&m:layer.markers){if(m.index<start||m.index>=end)continue;QPointF c(x(m.index),y(m.price));QPolygonF shape;
      if(m.shape=="diamond")shape<<c+QPointF(0,-5)<<c+QPointF(5,0)<<c+QPointF(0,5)<<c+QPointF(-5,0);
      else {int d=m.shape=="down"?-1:1;shape<<c+QPointF(0,-7*d)<<c+QPointF(-6,5*d)<<c+QPointF(6,5*d);}
      p.setPen(QPen(m.color,1.2));p.setBrush(m.shape=="diamond"?QBrush(Qt::NoBrush):QBrush(m.color));p.drawPolygon(shape);
      if(!m.id.isEmpty()&&m.id==layer.selectedId){p.setBrush(Qt::NoBrush);p.drawEllipse(c,9,9);}
      if(!m.label.isEmpty()){
        // Labels distinguish direction independently from the connection's colour.
        QRectF label(c.x()-14,m.shape=="down"?c.y()-27:c.y()+9,28,17);
        if(label.top()<rect.top())label.moveTop(c.y()+9);if(label.bottom()>rect.bottom())label.moveBottom(c.y()-9);
        p.drawText(label,Qt::AlignCenter,m.label);
      }
    }
  }
  p.restore();
}
}
