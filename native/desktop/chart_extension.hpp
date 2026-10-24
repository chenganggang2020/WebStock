#pragma once
#include <QMap>
#include <QPainter>
#include <QPainterPath>
#include <QVector>
#include <cmath>
#include <functional>

// Host drawing primitives. No engine, strategy, or plugin identifiers belong here.
namespace chartExtension {
struct Line { QString name; QColor color; QVector<QPointF> points; };
struct Marker { int index=-1; double price=0; QString shape, text, category; QColor color; };
struct Segment { QPointF from,to; QColor color; };
struct Layer { QVector<Line> lines; QVector<Marker> markers; QVector<Segment> segments; };
inline void range(const QMap<QString,Layer>& layers,int start,int end,double& lo,double& hi) {
  auto include=[&](QPointF p){if(p.x()>=start&&p.x()<end&&std::isfinite(p.y())){lo=std::min(lo,p.y());hi=std::max(hi,p.y());}};
  for(const auto& layer:layers){for(const auto& line:layer.lines)for(auto p:line.points)include(p);for(const auto&m:layer.markers)include({double(m.index),m.price});}
}
inline void paint(QPainter& p,const QRectF& rect,const QMap<QString,Layer>& layers,int start,int end,
                  const std::function<double(int)>& x,const std::function<double(double)>& y) {
  p.save();p.setClipRect(rect);
  for(const auto& layer:layers){
    for(const auto& line:layer.lines){QPainterPath path;bool joined=false;int prior=-2;
      for(auto at:line.points){int i=int(at.x());if(i<start||i>=end||!std::isfinite(at.y())){joined=false;continue;}
        QPointF point(x(i),y(at.y()));if(joined&&i==prior+1)path.lineTo(point);else path.moveTo(point);joined=true;prior=i;}
      p.setPen(QPen(line.color,1.7));p.setBrush(Qt::NoBrush);p.drawPath(path);
    }
    for(const auto&s:layer.segments){if(s.to.x()<start||s.from.x()>=end)continue;p.setPen(QPen(s.color,1,Qt::DotLine));p.drawLine(QPointF(x(int(s.from.x())),y(s.from.y())),QPointF(x(int(s.to.x())),y(s.to.y())));}
    for(const auto&m:layer.markers){if(m.index<start||m.index>=end)continue;QPointF c(x(m.index),y(m.price));QPolygonF shape;
      if(m.shape=="diamond")shape<<c+QPointF(0,-5)<<c+QPointF(5,0)<<c+QPointF(0,5)<<c+QPointF(-5,0);
      else {int d=m.shape=="down"?-1:1;shape<<c+QPointF(0,-7*d)<<c+QPointF(-6,5*d)<<c+QPointF(6,5*d);}
      p.setPen(QPen(m.color,1.2));p.setBrush(m.shape=="diamond"?QBrush(Qt::NoBrush):QBrush(m.color));p.drawPolygon(shape);
    }
  }
  p.restore();
}
}
