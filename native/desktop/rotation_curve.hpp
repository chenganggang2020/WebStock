#pragma once
#include <QWidget>
#include <QPainter>
#include <QMouseEvent>
#include <QJsonArray>
#include <QJsonObject>
#include <QDateTime>
#include <QTimeZone>
#include <cmath>

class RotationCurve final:public QWidget {
 QJsonArray data;int hover=-1;
 public:
 explicit RotationCurve(QWidget* p=nullptr):QWidget(p){setObjectName("rotationCurve");setMinimumHeight(230);setMouseTracking(true);setAccessibleName("轮动历史曲线；左轴模型净额亿元，右轴板块涨跌幅百分比");}
 void setData(const QJsonArray& values){data=values;hover=-1;setProperty("pointCount",data.size());update();}
 protected:
 void mouseMoveEvent(QMouseEvent* event) override {double target=(event->position().x()-65)/std::max(1,width()-130)*237*60000;double closest=1e20;hover=-1;for(int i=0;i<data.size();i++){double d=std::abs(data[i].toObject()["tradingTimeMs"].toDouble()-target);if(d<closest){closest=d;hover=i;}}update();}
 void leaveEvent(QEvent*) override {hover=-1;update();}
 void paintEvent(QPaintEvent*) override {
  QPainter p(this);p.setRenderHint(QPainter::Antialiasing);p.fillRect(rect(),palette().base());auto ink=palette().text().color();p.setPen(ink);p.drawText(10,18,"累计模型净额（亿元，蓝） / 板块涨跌幅（%，橙）");
  if(data.isEmpty()){p.drawText(rect(),Qt::AlignCenter,"没有可绘制的盘中采样；日榜不代替分钟历史");return;}
  QRectF box(65,55,std::max(1,width()-130),std::max(1,height()-90));p.setPen(palette().mid().color());p.drawRect(box);
  for(int column=0;column<2;column++){
   auto value=[&](QJsonObject o){return column==0?(o["cumulativeCents"].isString()?o["cumulativeCents"].toString().toDouble()/1e10:NAN):(o["changeRatio"].isDouble()?o["changeRatio"].toDouble()*100:NAN);};
   double low=INFINITY,high=-INFINITY;for(auto v:data){double n=value(v.toObject());if(std::isfinite(n)){low=std::min(low,n);high=std::max(high,n);}}if(!std::isfinite(low))continue;if(high-low<1e-9){high+=.01;low-=.01;}
   p.setPen(ink);for(int i=0;i<3;i++){double y=box.top()+box.height()*i/2.;QString label=QString::number(high-(high-low)*i/2,'f',2);p.drawText(QRectF(column?box.right()+3:0,y-9,62,18),column?Qt::AlignLeft:Qt::AlignRight,label);}
   p.save();p.setClipRect(box.adjusted(-1,-1,1,1));p.setPen(QPen(column?QColor("#ce8b28"):QColor("#347dde"),1.5));QPointF prior;bool have=false;
   for(auto v:data){auto o=v.toObject();double n=value(o);if(!std::isfinite(n)){have=false;continue;}QPointF point(box.left()+box.width()*o["tradingTimeMs"].toDouble()/(237*60000.),box.bottom()-box.height()*(n-low)/(high-low));if(have&&!o["gapBefore"].toBool())p.drawLine(prior,point);else p.drawEllipse(point,1.5,1.5);prior=point;have=true;}p.restore();
  }
  p.setPen(ink);for(auto tick:QList<QPair<int,QString>>{{0,"09:30"},{60,"10:30"},{120,"11:30/13:00"},{180,"14:00"},{237,"14:57"}}){double x=box.left()+box.width()*tick.first/237.;p.drawText(QRectF(x-45,box.bottom()+7,90,20),Qt::AlignCenter,tick.second);}
  if(hover>=0&&hover<data.size()){auto o=data[hover].toObject();double x=box.left()+box.width()*o["tradingTimeMs"].toDouble()/(237*60000.);p.setPen(QPen(palette().mid().color(),1,Qt::DashLine));p.drawLine(QPointF(x,box.top()),QPointF(x,box.bottom()));p.setPen(ink);auto at=QDateTime::fromString(o["at"].toString(),Qt::ISODateWithMs).toTimeZone(QTimeZone::fromSecondsAheadOfUtc(28800)).toString("HH:mm:ss");p.drawText(10,39,at+" 抓取 · 净额 "+(o["cumulativeCents"].isString()?QString::number(o["cumulativeCents"].toString().toDouble()/1e10,'f',3):"—")+" 亿 · 涨跌 "+(o["changeRatio"].isDouble()?QString::number(o["changeRatio"].toDouble()*100,'f',2):"—")+"%");}
 }
};
