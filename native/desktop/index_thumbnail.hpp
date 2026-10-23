#pragma once
#include "appearance.hpp"
#include <QtWidgets>
#include <QTimeZone>
#include <cmath>

class IndexThumbnail final:public QAbstractButton {
 QJsonObject definition,quote,metadata;QJsonArray rows;QString fetchedAt;
public:
 explicit IndexThumbnail(QJsonObject item,QWidget* parent):QAbstractButton(parent),definition(item){
  setObjectName("overviewThumbnail_"+item["symbol"].toString());setCheckable(true);setCursor(Qt::PointingHandCursor);setMinimumSize(144,96);setSizePolicy(QSizePolicy::Expanding,QSizePolicy::Fixed);
 }
 QSize sizeHint()const override{return {172,96};}
 void setData(QJsonObject value,QString fetched,QJsonArray points,QJsonObject meta){quote=value;fetchedAt=fetched;rows=points;metadata=meta;setToolTip(definition["name"].toString()+"\n报价获取 "+fetchedAt+"\n曲线日期 "+meta["dataDate"].toString()+"\n"+meta["error"].toString());update();}
 void paintEvent(QPaintEvent*)override{
  QPainter painter(this);painter.setRenderHint(QPainter::Antialiasing);const auto theme=appearance::theme(window()->property("stockTheme").toString());
  painter.fillRect(rect(),palette().color(isChecked()?QPalette::AlternateBase:QPalette::Base));painter.setPen(isChecked()?theme.accent:palette().color(QPalette::Mid));painter.drawRoundedRect(rect().adjusted(1,1,-2,-2),4,4);
  const auto pct=quote["changePct"];QColor color=pct.isDouble()?(pct.toDouble()>0?theme.up:pct.toDouble()<0?theme.down:palette().color(QPalette::Text)):theme.accent;
  painter.setPen(palette().color(QPalette::Text));painter.drawText(QRect(9,5,width()-18,20),Qt::AlignLeft|Qt::AlignVCenter,definition["name"].toString());
  painter.setPen(color);const auto price=quote["price"];painter.drawText(QRect(9,26,width()-18,20),Qt::AlignLeft|Qt::AlignVCenter,(price.isDouble()?QString::number(price.toDouble(),'f',2):QString("—"))+"   "+(pct.isDouble()?QString::number(pct.toDouble(),'f',2)+"%":QString()));
  double low=INFINITY,high=-INFINITY;for(auto value:rows){auto r=value.toObject();if(r["valid"].toBool()&&r["close"].isDouble()){low=std::min(low,r["close"].toDouble());high=std::max(high,r["close"].toDouble());}}
  QRectF plot(9,50,width()-18,27);bool previous=false;QPointF last;
  if(std::isfinite(low)){const auto span=std::max(high-low,std::max(.01,high*.0001));painter.setPen(QPen(color,1.3));for(int i=0;i<rows.size();++i){auto r=rows[i].toObject();if(!r["valid"].toBool()||!r["close"].isDouble()){previous=false;continue;}QPointF point(plot.left()+plot.width()*i/std::max(1,int(rows.size())-1),plot.bottom()-(r["close"].toDouble()-low)/span*plot.height());if(previous)painter.drawLine(last,point);else painter.drawEllipse(point,1,1);last=point;previous=true;}}
  painter.setPen(palette().color(QPalette::Text));auto date=metadata["dataDate"].toString();if(date.isEmpty())date=QDateTime::fromString(fetchedAt,Qt::ISODateWithMs).toTimeZone(QTimeZone("Asia/Shanghai")).toString("MM-dd HH:mm");else date=date.mid(5)+" 分时";painter.drawText(QRect(9,77,width()-18,16),Qt::AlignLeft|Qt::AlignVCenter,date.isEmpty()?"等待行情":date);
 }
};
