#pragma once
#include <QtWidgets>
#include <cmath>
#include <algorithm>
class DarkObservationCurve final:public QWidget {
 QJsonArray points;int hovered=-1;
 qint64 at(QJsonObject p)const{return QDateTime::fromString(p.value("row").toObject().value("receivedAt").toString(),Qt::ISODateWithMs).toMSecsSinceEpoch();}
public:
 explicit DarkObservationCurve(QWidget* parent=nullptr):QWidget(parent){setObjectName("darkObservationCurve");setMinimumHeight(180);setMaximumHeight(230);setMouseTracking(true);setAccessibleName("已存个股模型净额；横轴原本行接收时刻，不是逐笔或行情事件时间");}
 void setPoints(QJsonArray data){points=std::move(data);hovered=-1;setProperty("pointCount",points.size());update();}
protected:
 void mouseMoveEvent(QMouseEvent* e)override{hovered=-1;double best=1e30;if(!points.isEmpty()){auto first=at(points.first().toObject()),last=at(points.last().toObject());for(int i=0;i<points.size();++i){double x=first==last?width()/2.:75+(width()-150.)*(at(points[i].toObject())-first)/double(last-first);auto distance=std::abs(x-e->position().x());if(distance<best){best=distance;hovered=i;}}}update();}
 void leaveEvent(QEvent*)override{hovered=-1;update();}
 void paintEvent(QPaintEvent*)override{
  QPainter p(this);p.setRenderHint(QPainter::Antialiasing);p.fillRect(rect(),palette().base());p.setPen(palette().text().color());p.drawText(8,16,"已存模型净额 / 万元 · 横轴为原接收时刻(+08)，非逐笔/行情时刻；图为近似，原整数分见表和详情");
  if(points.isEmpty()){p.drawText(rect(),Qt::AlignCenter,"没有已存观察，不补零或推断走势");return;}
  QStringList fields{"darkNetCents","visibleNetCents","combinedNetCents"};QList<QColor> colors{QColor("#52a8ff"),QColor("#e3a44c"),QColor("#6dc69b")};QStringList names{"暗盘模型","明盘模型","合计模型"};double lo=INFINITY,hi=-INFINITY;
  for(auto point:points)for(auto f:fields){auto v=point.toObject().value("row").toObject().value(f);if(!v.isString())continue;bool ok=false;double amount=v.toString().toDouble(&ok)/1e6;if(ok&&std::isfinite(amount)){lo=std::min(lo,amount);hi=std::max(hi,amount);}}
  if(!std::isfinite(lo)){p.drawText(rect(),Qt::AlignCenter,"金额缺失，不补0");return;}if(hi==lo){auto pad=std::max(1.,std::abs(hi)*1e-6);hi+=pad;lo-=pad;}
  auto first=at(points.first().toObject()),last=at(points.last().toObject());QRectF box(75,44,std::max(1,width()-150),std::max(1,height()-78));p.setPen(palette().mid().color());p.drawRect(box);
  p.setPen(palette().text().color());for(int i=0;i<3;++i){auto y=box.top()+box.height()*i/2.;p.drawText(QRectF(0,y-9,70,18),Qt::AlignRight,QString::number(hi-(hi-lo)*i/2.,'g',7));}
  for(int field=0;field<fields.size();++field){p.setPen(colors[field]);p.drawText(12+field*130,34,names[field]);p.save();p.setClipRect(box.adjusted(-2,-2,2,2));p.setPen(QPen(colors[field],1.7));bool have=false;QPointF prior;QJsonObject previous;
   for(auto value:points){auto current=value.toObject();auto row=current.value("row").toObject();bool ok=false;auto raw=row.value(fields[field]);double y=raw.isString()?raw.toString().toDouble(&ok)/1e6:NAN;if(!ok||!std::isfinite(y)){have=false;continue;}double x=first==last?box.center().x():box.left()+box.width()*(at(current)-first)/double(last-first);QPointF next(x,box.bottom()-box.height()*(y-lo)/(hi-lo));bool gap=!previous.isEmpty()&&(at(current)-at(previous)>600000||previous.value("sourceKey")!=current.value("sourceKey"));if(have&&!gap)p.drawLine(prior,next);p.drawEllipse(next,2.5,2.5);prior=next;previous=current;have=true;}
   p.restore();
  }
  p.setPen(palette().text().color());for(int i=0;i<(first==last?1:3);++i){qint64 tick=first==last?first:first+(last-first)*i/2;double x=first==last?box.center().x():box.left()+box.width()*i/2.;auto text=QDateTime::fromMSecsSinceEpoch(tick).toOffsetFromUtc(28800).toString("MM-dd HH:mm:ss");p.drawText(QRectF(x-70,box.bottom()+5,140,20),Qt::AlignCenter,text);}
  if(points.size()==1)p.drawText(box,Qt::AlignCenter,"仅1个观察点，不推断趋势");
  if(hovered>=0&&hovered<points.size()){auto row=points[hovered].toObject().value("row").toObject();setToolTip(row.value("receivedAt").toString()+"\n暗/明/合计原始整数分："+row.value("darkNetCents").toString()+" / "+row.value("visibleNetCents").toString()+" / "+row.value("combinedNetCents").toString());}
 }
};
